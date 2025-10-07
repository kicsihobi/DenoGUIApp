




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

interpret: 
	deno run ${COMPILE_FLAGS} ${MAIN}

build: ${APP_NAME}

sslcert: src/ssl/localhost.crt src/ssl/localhost.key

sslrun: ${APP_NAME} sslcert
	./$(APP_NAME) --cert=src/ssl/localhost.crt --key=src/ssl/localhost.key

sslinterpret: ${APP_NAME} sslcert
	deno run ${COMPILE_FLAGS} ${MAIN} --port 8000 --cert=src/ssl/localhost.crt --key=src/ssl/localhost.key

src/ssl/localhost.crt src/ssl/localhost.key &:
	openssl req -x509 -out src/ssl/localhost.crt -keyout src/ssl/localhost.key \
  		-newkey rsa:2048 -nodes -sha256 \
  		-subj '/CN=localhost'

${APP_NAME}: $(ASSET_OUTPUT)
	@echo "Compiling app to $(APP_NAME)..."
	deno compile $(DENO_COMPILE_FLAGS) --output $(APP_NAME) $(MAIN)
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
	@echo "  make interpret    - Run the script interpreted by system installed deno."
	@echo "  make sslcert      - Generate a standard dummy certificate to be used when hosting on localhost"
	@echo "  make sslrun       - Same as run but using the certs from sslcert"
	@echo "  make sslinterpret - GSame as interpret but using the certs from sslcert"
	@echo "  make clean        - Remove binary and generated assets"
	@echo "  make help         - Show this help"

.PHONY: all interpret run build clean help sslcert sslrun sslinterpret