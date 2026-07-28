# syntax=docker/dockerfile:1.7

FROM clamav/clamav-debian:1.5.3@sha256:9ea1c2bc1955c58d094bb3d168718d0173c7899096012523278ad76e06cc75a2

# Keep the daemon's independently enforced limits aligned with the worker's
# 100,000,000-byte public contract. AlertExceedsMax converts analysis-limit
# skips into detections instead of silently reporting a clean scan.
RUN sed -i \
      -e 's/^#TCPAddr .*/TCPAddr 0.0.0.0/' \
      -e 's/^#StreamMaxLength .*/StreamMaxLength 100000000/' \
      -e 's/^#MaxScanSize .*/MaxScanSize 400M/' \
      -e 's/^#MaxFileSize .*/MaxFileSize 100000000/' \
      -e 's/^#AlertExceedsMax .*/AlertExceedsMax yes/' \
      /etc/clamav/clamd.conf \
    && grep -Fx 'TCPSocket 3310' /etc/clamav/clamd.conf \
    && grep -Fx 'TCPAddr 0.0.0.0' /etc/clamav/clamd.conf \
    && grep -Fx 'StreamMaxLength 100000000' /etc/clamav/clamd.conf \
    && grep -Fx 'MaxScanSize 400M' /etc/clamav/clamd.conf \
    && grep -Fx 'MaxFileSize 100000000' /etc/clamav/clamd.conf \
    && grep -Fx 'AlertExceedsMax yes' /etc/clamav/clamd.conf

USER 1000:1000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/init-unprivileged"]
