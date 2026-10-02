ARG BUILD_FROM
FROM ${BUILD_FROM}
RUN apk add --no-cache python3
COPY app /app
CMD ["python3", "/app/server.py"]

