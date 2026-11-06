FROM golang:1.24-alpine AS builder
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/securemesh ./cmd/api-gateway

FROM alpine:3.20
RUN adduser -D appuser
USER appuser
WORKDIR /app

COPY --from=builder /bin/securemesh /usr/local/bin/securemesh
EXPOSE 8080

ENTRYPOINT ["securemesh"]
