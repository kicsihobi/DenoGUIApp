




APP_NAME = DenoGUIApp
MAIN = main.ts
ASSET_FOLDER = static
IGNORE_FILE = ignoreasset
ASSET_OUTPUT = src/static_assets.ts





ASSET_FLAGS = --allow-read --allow-write
COMPILE_FLAGS = --allow-net --allow-read --allow-run





all: run

run: ${APP_NAME}
	./$(APP_NAME)

build: ${APP_NAME}

sslcert: src/ssl/localhost.crt src/ssl/localhost.key

src/ssl/localhost.crt src/ssl/localhost.key &:
	openssl req -x509 -out src/ssl/localhost.crt -keyout src/ssl/localhost.key \
  		-newkey rsa:2048 -nodes -sha256 \
  		-subj '/CN=localhost'

${APP_NAME}: $(ASSET_OUTPUT)
	@echo "Compiling app to $(APP_NAME)..."
	deno compile $(COMPILE_FLAGS) --output $(APP_NAME) $(MAIN)
	@echo "Build complete: $(APP_NAME)"

$(ASSET_OUTPUT):
	@echo "Generating embedded assets..."
	deno run $(ASSET_FLAGS) generate_assets.ts \
		--folder $(ASSET_FOLDER) \
		--ignore $(IGNORE_FILE) \
		--output $(ASSET_OUTPUT) \
		--threads 4
	@echo "Assets generated: $(ASSET_OUTPUT)"

clean:
	@echo "Cleaning build files..."
	rm -f $(APP_NAME) $(ASSET_OUTPUT)
	@echo "Cleaned."

help:
	@echo "Usage:"
	@echo "  make              - Build the binary (generates assets first)"
	@echo "  make run          - Run the executable only (and build before if not present)"
	@echo "  make build        - Build the executable."
	@echo "  make assets       - Generate assets file."
	@echo "  make sslcert      - Generate a standard dummy certificate to be used when hosting on localhost"
	@echo "  make clean        - Remove binary and generated assets"
	@echo "  make help         - Show this help"

.PHONY: all run build clean help sslcert