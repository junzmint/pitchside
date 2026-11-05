.PHONY: up down db api web logs reset seed seed-local

# Chạy toàn bộ bằng Docker: http://localhost:5195
up:
	LAN_IP=$$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1) docker compose up -d --build

down:
	docker compose down

# Chế độ dev: chỉ chạy Postgres trong Docker, backend + frontend chạy local
db:
	docker compose up -d db

api:
	cd backend && go run .

web:
	cd frontend && npm install && npm run dev

logs:
	docker compose logs -f api

# Xoá toàn bộ dữ liệu game
reset:
	docker compose down -v

# Load demo accounts and careers from backend/seed.json (skips users that already exist)
seed:
	docker compose exec api /api seed

# Same, against the dev database (make db + make api setup)
seed-local:
	cd backend && go run . seed
