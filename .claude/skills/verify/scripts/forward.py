#!/usr/bin/env python3
# TCP forwarder 127.0.0.1:LISTEN -> 127.0.0.1:TARGET. Killing it cuts RoomBai off from a T3 server without touching the server.
import socket, sys, threading
lp, tp = int(sys.argv[1]), int(sys.argv[2])
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(('127.0.0.1', lp)); srv.listen()
while True:
    c, _ = srv.accept(); u = socket.create_connection(('127.0.0.1', tp))
    threading.Thread(target=pipe, args=(c, u), daemon=True).start(); threading.Thread(target=pipe, args=(u, c), daemon=True).start()
