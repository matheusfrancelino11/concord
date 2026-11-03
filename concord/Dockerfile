FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata curl

COPY concord-linux ./concord-server
RUN chmod +x ./concord-server

# Persistent uploads folder
RUN mkdir -p uploads

EXPOSE 8080

CMD ["./concord-server"]
