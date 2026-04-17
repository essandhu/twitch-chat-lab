# syntax=docker/dockerfile:1.7

# Stage 1: build
FROM golang:1.22-alpine AS build
WORKDIR /src

# Cache modules layer
COPY go.mod go.sum ./
RUN go mod download

# Build statically linked binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/proxy ./cmd/server

# Stage 2: runtime (distroless, nonroot)
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /bin/proxy /proxy
EXPOSE 8080
ENTRYPOINT ["/proxy"]
