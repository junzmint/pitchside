FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /api .

FROM alpine:3.20
COPY --from=build /api /api
EXPOSE 8095
CMD ["/api"]
