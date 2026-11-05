.PHONY: up up-lan down db api web logs reset seed seed-local vacuum

# Chạy toàn bộ bằng Docker, chỉ trên máy này: http://localhost:5195
up:
	docker compose up -d --build

# Như `make up`, nhưng mở trò chơi cho các máy cùng Wi-Fi (chơi 2 người qua Wi-Fi, điện thoại, máy tính bảng)
up-lan:
	WEB_BIND=0.0.0.0 LAN_IP=$$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1) docker compose up -d --build

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

# Thu gọn cơ sở dữ liệu nếu trò chơi chậm dần (bảng phình to sau nhiều mùa giải hoặc nhiều lần xoá career).
# Mất vài giây, chạy lúc không chơi.
vacuum:
	docker compose exec -T db psql -U pitch -d pitchside -c 'VACUUM (FULL, ANALYZE) players, player_stats, fixtures, clubs, coaches, templates, news, finances, careers'

# Xoá toàn bộ dữ liệu game
reset:
	docker compose down -v

# Load demo accounts and careers from backend/seed.json (skips users that already exist)
seed:
	docker compose exec api /api seed

# Same, against the dev database (make db + make api setup)
seed-local:
	cd backend && go run . seed
