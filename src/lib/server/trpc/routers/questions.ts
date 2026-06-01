import { z } from "zod";
import { Role, QuestionType } from "$lib/generated/prisma/client";
import { router, publicProcedure, adminProcedure } from "../init";

const questionInput = z.object({
  title: z.string().min(1),
  type: z.nativeEnum(QuestionType),
  order: z.number().int().default(0),
  required: z.boolean().default(false),
  targetRole: z.array(z.nativeEnum(Role)).default([]),
  placeholder: z.string().optional(),
  options: z.array(z.string()).default([]),
  min: z.number().optional(),
  max: z.number().optional(),
  regex: z.string().optional(),
  linkedField: z.string().optional(),
});

export const questionsRouter = router({
  list: publicProcedure
    .input(z.object({ role: z.nativeEnum(Role).optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.question.findMany({
        where: input.role
          ? {
              OR: [
                { targetRole: { isEmpty: true } },
                { targetRole: { has: input.role } },
              ],
            }
          : undefined,
        orderBy: { order: "asc" },
      });
    }),

  listAll: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.question.findMany({ orderBy: { order: "asc" } });
  }),

  create: adminProcedure
    .input(questionInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.question.create({ data: input });
    }),

  update: adminProcedure
    .input(z.object({ id: z.string() }).merge(questionInput))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.prisma.question.update({ where: { id }, data });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.question.delete({ where: { id: input.id } });
    }),

  reorder: adminProcedure
    .input(z.array(z.object({ id: z.string(), order: z.number().int() })))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(
        input.map((item) =>
          ctx.prisma.question.update({
            where: { id: item.id },
            data: { order: item.order },
          }),
        ),
      );
      return { success: true };
    }),

  change: adminProcedure
    .input(
      z.object({
        deleted: z.array(z.object({ id: z.string() })).default([]),
        modified: z
          .array(z.object({ id: z.string() }).merge(questionInput))
          .default([]),
        added: z.array(questionInput).default([]),
        reordered: z
          .array(z.object({ id: z.string(), order: z.number().int() }))
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async (tx) => {
        for (const q of input.deleted) {
          await tx.question.delete({ where: { id: q.id } });
        }
        for (const q of input.modified) {
          const { id, ...data } = q;
          await tx.question.update({ where: { id }, data });
        }
        for (const q of input.added) {
          await tx.question.create({ data: q });
        }
        for (const q of input.reordered) {
          await tx.question.update({
            where: { id: q.id },
            data: { order: q.order },
          });
        }
      });
      return { success: true };
    }),
});
