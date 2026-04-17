# proxy

Go service that fans in Twitch EventSub chat streams for the frontend.

## Dependencies

- `go` >= 1.22

## Local development

```sh
cp .env.example .env
go run ./cmd/server
go test ./...
```
