.PHONY: build build-service build-codemirror install dev format

build-service:
	cd packages/typst-web-service && bun run build

build-codemirror: build-service
	cd packages/codemirror-typst && bun run build

build: build-codemirror

install:
	bun install

format:
	npx biome check --write .

dev: build
	rm -rf demo/node_modules/.vite
	cd demo && bun dev
