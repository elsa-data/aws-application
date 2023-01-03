FROM amazon/aws-lambda-nodejs:18
WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev
COPY index.mjs ./

CMD [ "index.handler" ]
