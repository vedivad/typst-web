.PHONY: build install dev

build:
	bun run build

install:
	cd demo && bun i

dev: build install
	rm -rf demo/node_modules/.vite
	cd demo && bun dev
