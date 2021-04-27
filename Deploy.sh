#!/bin/bash
docker stop project-e4fi
docker rm project-e4fi
docker build -t e4fi/project .
docker run -d -p 8080:80 -v /srv/project-e4fi/:/usr/src/app/data/ --restart always --name project-e4fi -it e4fi/project
