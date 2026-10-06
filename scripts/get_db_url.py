#!/usr/bin/env python3
"""
Standalone DB URL detector for zprime test suites.

Produces the correct DATABASE_URL for the TSX server so it can connect to the
postgres DB running inside the zprime-db-1 docker container.

The previous code used `SELECT inet_server_addr()::text || ':' || inet_server_port::text`
which FAILS on PostgreSQL 16 because `inet_server_port` doesn't exist (it was added
in PG 17+). This causes the docker exec to return empty, and the suite falls back
to an abstract socket URL which the node postgres driver also rejects.

This script uses the correct query and proper fallback chain:
1. Try the docker exec with the CORRECT query (using pg_settings.port)
2. Fall back to DNS resolution of zprime-db-1
3. Fall back to docker inspect to get the container's IP
4. Last resort: use the docker bridge gateway (172.17.0.1)
"""
import subprocess, os, sys, socket

def get_db_url():
    # Step 1: try docker exec with CORRECT query
    try:
        result = subprocess.run(
            ["docker", "exec", "zprime-db-1", "psql", "-U", "zprime", "-t", "-c",
             "SELECT inet_server_addr()::text || ':' || (SELECT setting::int FROM pg_settings WHERE name='port')"],
            capture_output=True, text=True, timeout=10
        )
        _db_env = result.stdout.strip()
        if _db_env and _db_env != "-" and ":" in _db_env:
            addr, port = _db_env.rsplit(":", 1)
            if addr and port.isdigit():
                url = f"postgres://zprime:zprime@{addr}:{port}/zprime"
                print(f"DB_URL=postgres://zprime:zprime@{addr}:{port}/zprime (via docker exec)", file=sys.stderr)
                return url
    except Exception as e:
        print(f"docker exec query failed: {e}", file=sys.stderr)
    
    # Step 2: DNS resolution
    try:
        resolved = socket.getaddrinfo("zprime-db-1", 5432, socket.AF_UNSPEC, socket.SOCK_STREAM)
        if resolved:
            host = resolved[0][4][0]
            url = f"postgres://zprime:zprime@{host}:5432/zprime"
            print(f"DB_URL=postgres://zprime:zprime@{host}:5432/zprime (via DNS)", file=sys.stderr)
            return url
    except Exception as e:
        print(f"DNS resolution failed: {e}", file=sys.stderr)
    
    # Step 3: docker inspect
    try:
        result = subprocess.run(
            ["docker", "inspect", "zprime-db-1",
             "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"],
            capture_output=True, text=True, timeout=5
        )
        host = result.stdout.strip()
        if host:
            url = f"postgres://zprime:zprime@{host}:5432/zprime"
            print(f"DB_URL=postgres://zprime:zprime@{host}:5432/zprime (via docker inspect)", file=sys.stderr)
            return url
    except Exception as e:
        print(f"docker inspect failed: {e}", file=sys.stderr)
    
    # Step 4: docker bridge gateway
    url = "postgres://zprime:zprime@172.17.0.1:5432/zprime"
    print(f"DB_URL={url} (docker bridge gateway fallback)", file=sys.stderr)
    return url

if __name__ == "__main__":
    print(get_db_url())
