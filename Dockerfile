# CI image for .gitlab-ci.yml. Exists solely so psql is available alongside
# node/npm for the per-branch CREATE/DROP DATABASE steps. Build and push once:
#
#   docker login registry.gitlab.com
#   docker build -t registry.gitlab.com/freetail-hackers/rodeo-2.0 .
#   docker push registry.gitlab.com/freetail-hackers/rodeo-2.0
#
# Node major matches the Vercel runtime (nodejs22.x in svelte.config.js).
FROM node:22

RUN apt-get update \
	&& apt-get install -y --no-install-recommends postgresql-client \
	&& rm -rf /var/lib/apt/lists/*
