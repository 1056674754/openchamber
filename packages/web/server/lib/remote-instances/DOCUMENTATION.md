# Remote Instances

Owns configured remote OpenChamber instances, health/request lanes, HTTP and WebSocket proxying, and event fan-in.

- `global-event-fanout.js` carries authoritative OpenCode global events from every healthy remote.
- `openchamber-event-fanout.js` carries OpenChamber synthetic events only while a local Electron global socket advertises Browser control capability.
- Synthetic Browser events use `/api/openchamber/events?browser=1`, preserve the remote `serverId`, and consume one isolated `stream` lane per eligible remote.
- A legacy remote returning 404/405/410 is treated as capability-unsupported: the stream stops and releases its lane without degrading remote health or retrying rapidly.
- The global WebSocket bridge forwards synthetic events only to capable Browser clients. Ordinary browser clients neither start the fanout nor receive control requests.

All remote mutations and replies must route through the originating `serverId`; a directory string alone is not unique across instances.
