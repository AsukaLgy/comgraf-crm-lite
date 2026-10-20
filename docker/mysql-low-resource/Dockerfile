FROM debian:12-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

ARG MYSQL_SERVER_VERSION=8.4.13-1debian12
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*

# Verify Oracle's published MySQL APT signing key before trusting the repository.
RUN curl -fsSLo /tmp/mysql-archive-key.asc https://repo.mysql.com/RPM-GPG-KEY-mysql-2025 \
 && test "$(gpg --show-keys --with-colons /tmp/mysql-archive-key.asc | awk -F: '$1 == "fpr" { print $10; exit }')" = 'BCA43417C3B485DD128EC6D4B7B3B788A8D3785C' \
 && gpg --dearmor < /tmp/mysql-archive-key.asc > /usr/share/keyrings/mysql-archive-keyring.gpg \
 && rm /tmp/mysql-archive-key.asc \
 && printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/mysql-archive-keyring.gpg] https://repo.mysql.com/apt/debian/ bookworm mysql-8.4-lts' > /etc/apt/sources.list.d/mysql.list \
 && printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
 && chmod +x /usr/sbin/policy-rc.d \
 && apt-get update \
 && apt-get install -y --no-install-recommends "mysql-community-server=${MYSQL_SERVER_VERSION}" \
 && usermod --uid 10001 mysql \
 && groupmod --gid 10001 mysql \
 && rm -f /usr/sbin/policy-rc.d \
 && rm -rf /var/lib/apt/lists/* /var/cache/debconf/*-old

COPY mysql-entrypoint.sh /usr/local/bin/mysql-entrypoint
COPY low-resource.cnf /etc/mysql/conf.d/zzz-comgraf-low-resource.cnf
RUN chmod 0755 /usr/local/bin/mysql-entrypoint \
 && mkdir -p /var/log/mysql /run/mysqld \
 && chown -R mysql:mysql /var/log/mysql /run/mysqld /var/lib/mysql

EXPOSE 3306
ENTRYPOINT ["/usr/local/bin/mysql-entrypoint"]
CMD ["mysqld", "--user=mysql", "--console"]
