# Dashie Hermes Agent add-on — a thin wrapper over the official image.
# The upstream ENTRYPOINT ["/init", "main-wrapper.sh"] (s6-overlay) is kept:
# /init runs cont-init.d (including ours below) before the CMD, and
# main-wrapper.sh routes a first-arg executable straight to exec — so our
# CMD script runs venv-activated, env-populated, dropped to the hermes user.
ARG BUILD_FROM
FROM ${BUILD_FROM}

COPY rootfs/etc/cont-init.d/00-dashie-hermes.sh /etc/cont-init.d/00-dashie-hermes.sh
COPY rootfs/usr/local/bin/dashie-hermes-run /usr/local/bin/dashie-hermes-run
RUN chmod +x /etc/cont-init.d/00-dashie-hermes.sh /usr/local/bin/dashie-hermes-run

CMD ["dashie-hermes-run"]
