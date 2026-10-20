#!/bin/sh
# Read-only inventory for the Comgraf LAN-light target. No packages/config are changed.
set -u

section() { printf '\n== %s ==\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

section 'Date and operating system'
date -Is 2>/dev/null || date
uname -a
if [ -r /etc/os-release ]; then sed -n '1,12p' /etc/os-release; fi
printf 'process_bits='; getconf LONG_BIT 2>/dev/null || printf 'unknown\n'

section 'CPU and instruction set'
if have lscpu; then lscpu | sed -n '1,28p'; else cat /proc/cpuinfo | awk -F: '/^(processor|model name|flags)[[:space:]]*:/ {print $1 ":" substr($0,index($0,$2))}' | head -n 12; fi
if [ -r /proc/cpuinfo ]; then
  flags=$(awk -F: '/^flags[[:space:]]*:/ {print $2; exit}' /proc/cpuinfo)
  case " $flags " in *' lm '*) printf 'cpu_64bit=yes\n' ;; *) printf 'cpu_64bit=unknown_or_no\n' ;; esac
  missing=''
  for flag in cx16 lahf_lm popcnt pni ssse3 sse4_1 sse4_2; do
    case " $flags " in *" $flag "*) : ;; *) missing="$missing $flag" ;; esac
  done
  if [ -z "$missing" ]; then printf 'cpu_x86_64_v2_flags=present (loader check still recommended)\n'; else printf 'cpu_x86_64_v2_flags=missing:%s\n' "$missing"; fi
fi
loader=''
for candidate in /lib64/ld-linux-x86-64.so.2 /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2; do
  if [ -x "$candidate" ]; then loader=$candidate; break; fi
done
if [ -n "$loader" ]; then "$loader" --help 2>/dev/null | awk '/x86-64-v[234]/ {print "glibc_" $0}'; fi

section 'Memory and swap'
free -h 2>/dev/null || cat /proc/meminfo | head -n 8
if have swapon; then swapon --show --bytes 2>/dev/null || true; fi

section 'Disks, filesystems and mounts'
if have lsblk; then lsblk -e 7 -o NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINTS 2>/dev/null || lsblk; fi
df -hT 2>/dev/null
if have findmnt; then findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null; fi

section 'Docker and Compose'
if have docker; then
  docker --version 2>&1
  docker compose version 2>&1
  docker info --format 'root={{.DockerRootDir}} architecture={{.Architecture}} cgroup={{.CgroupVersion}}' 2>&1
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1
else
  printf 'docker=not-installed\n'
fi

section 'Listening ports'
if have ss; then ss -lntup 2>&1; elif have netstat; then netstat -lntup 2>&1; else printf 'ss/netstat unavailable\n'; fi

section 'Relevant service status (read-only)'
if have systemctl; then
  for service in docker containerd mysql mariadb smbd nmbd caddy nginx apache2; do
    state=$(systemctl is-active "$service" 2>/dev/null || true)
    [ -n "$state" ] && printf '%s=%s\n' "$service" "$state"
  done
fi
printf '\nInventory complete. No configuration or service was changed.\n'
