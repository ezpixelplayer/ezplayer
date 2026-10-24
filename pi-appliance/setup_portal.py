#!/usr/bin/python3
"""Unprivileged setup-network-only proxy for the player's existing phone UI."""
import asyncio
import ipaddress
import json
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web
from pi_hotspot import ADDRESS

LANDING = '/playbacksettings?section=piNetwork'
NETWORK = ipaddress.ip_network(ADDRESS + '/24', strict=False)
HOP_HEADERS = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
               'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'}
CLIENT = web.AppKey('client', ClientSession)


def setup_client(local, remote):
    try:
        return local == ADDRESS and ipaddress.ip_address(remote) in NETWORK
    except ValueError:
        return False


def player_port(path='/run/ezplayer-pi/web-port.json'):
    port = json.loads(Path(path).read_text()).get('port')
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Invalid registered player port')
    return port


async def proxy(request):
    local = request.transport.get_extra_info('sockname')[0]
    if not setup_client(local, request.remote):
        raise web.HTTPNotFound()
    # Captive-network probes and unknown hosts always land on Network settings.
    if request.host not in (ADDRESS, ADDRESS + ':80', 'ezplayer.setup', 'ezplayer.setup:80'):
        if request.method not in ('GET', 'HEAD'):
            raise web.HTTPForbidden()
        raise web.HTTPFound('http://' + ADDRESS + LANDING)
    if request.path == '/' or request.path in ('/generate_204', '/gen_204', '/hotspot-detect.html', '/connecttest.txt', '/ncsi.txt', '/canonical.html', '/success.txt'):
        raise web.HTTPFound(LANDING)
    try:
        port = player_port()
    except (OSError, ValueError, KeyError):
        return web.Response(status=503, text='EZPlayer is starting. Refresh this page in a few seconds.',
                            headers={'Refresh': '5', 'Cache-Control': 'no-store'})
    target = 'http://127.0.0.1:' + str(port) + request.raw_path
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    if web.WebSocketResponse().can_prepare(request).ok:
        if request.path != '/ws':
            raise web.HTTPForbidden()
        try:
            upstream = await request.app[CLIENT].ws_connect(target, headers=headers, max_msg_size=16 * 1024 * 1024)
        except Exception:
            raise web.HTTPServiceUnavailable(text='Player connection unavailable') from None
        downstream = web.WebSocketResponse(max_msg_size=16 * 1024 * 1024)
        await downstream.prepare(request)

        async def relay(source, destination):
            async for msg in source:
                if msg.type == WSMsgType.TEXT:
                    await destination.send_str(msg.data)
                elif msg.type == WSMsgType.BINARY:
                    await destination.send_bytes(msg.data)
                elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break

        tasks = [asyncio.create_task(relay(downstream, upstream)), asyncio.create_task(relay(upstream, downstream))]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await upstream.close()
            await downstream.close()
        return downstream
    try:
        async with request.app[CLIENT].request(request.method, target, headers=headers,
                                                data=request.content, allow_redirects=False) as response:
            output = web.StreamResponse(status=response.status, headers={
                k: v for k, v in response.headers.items() if k.lower() not in HOP_HEADERS})
            await output.prepare(request)
            async for chunk in response.content.iter_chunked(65536):
                await output.write(chunk)
            await output.write_eof()
            return output
    except (OSError, asyncio.TimeoutError):
        raise web.HTTPServiceUnavailable(text='EZPlayer is starting. Refresh in a few seconds.') from None


async def client_lifetime(app):
    async with ClientSession(timeout=ClientTimeout(total=None, sock_connect=5, sock_read=70), auto_decompress=False) as client:
        app[CLIENT] = client
        yield


def create_app():
    app = web.Application(client_max_size=32 * 1024 * 1024)
    app.cleanup_ctx.append(client_lifetime)
    app.router.add_route('*', '/{tail:.*}', proxy)
    return app


if __name__ == '__main__':
    web.run_app(create_app(), host='0.0.0.0', port=80, access_log=None, print=None)
