build-service:
    cd packages/typst-web-service && bun run build

build-yjs: build-service
    cd packages/typst-web-yjs && bun run build

build-codemirror: build-yjs
    cd packages/codemirror-typst && bun run build

build: build-codemirror

install:
    bun install

dev: build
    rm -rf demo/node_modules/.vite
    cd demo && bun run dev & \
    wait

test: build
    bun run test

test-watch:
    bun run test:watch

format:
    bun run format

lint:
    bun run lint

check:
    bun run check

# Spell-check docs and TS sources (config in .codebook.toml).
spellcheck:
    codebook-lsp lint .

# Record a changeset describing your change (commit the file with your PR).
changeset:
    bunx changeset
