# Production multi-stage Dockerfile for the payment-processing contract.
#
# Build the production image with:
#   docker build -t payment-processing-contract:latest .
#
# The final runtime image contains only the compiled WASM artifact and the
# required configuration files. No cargo, rustup, npm, or other dev tooling is
# present in the runtime stage.

# ---------------------------------------------------------------------------
# Stage 1: builder — compiles the contract to wasm32-unknown-unknown
# ---------------------------------------------------------------------------
FROM rust:1.79-bookworm AS builder

# Install only build-time tooling required to compile the contract.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        binaryen \
        ca-certificates \
        clang \
        lld \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Ensure the wasm target is available for the pinned toolchain.
RUN rustup target add wasm32-unknown-unknown

WORKDIR /build

# Cache dependency compilation by copying manifests first.
COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts

# Build the payment-processing contract in release mode with a locked
# dependency graph.
RUN cargo build \
        --locked \
        --release \
        --target wasm32-unknown-unknown \
        --package payment-processing

# Optimize the produced artifact when binaryen is available.
RUN wasm-opt -Oz \
        target/wasm32-unknown-unknown/release/payment_processing.wasm \
        -o /build/payment_processing.wasm

# ---------------------------------------------------------------------------
# Stage 2: runtime — minimal image with only the compiled artifact and config
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# Create an unprivileged user to run the container.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Copy only the compiled WASM artifact and required configuration files.
COPY --from=builder /build/payment_processing.wasm /app/payment_processing.wasm
COPY --chown=app:app config /app/config

# Drop privileges.
USER app

# Minimal entrypoint/command: the artifact is the deployable unit and is
# emitted to stdout for consumption by the host runtime.
ENTRYPOINT ["/bin/cat"]
CMD ["/app/payment_processing.wasm"]