/**
 * Fixture show-folder generator: a minimal xLights-managed show whose single
 * controller (DDP, or E1.31 on request) points at 127.0.0.1, so all light
 * output lands on a local mock controller. XML shapes verified against
 * readControllersFromXlights (see fixtures.test.ts).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface FixtureShowOptions {
    /** Controller/model channel count; must be a multiple of 3. Default 150. */
    channels?: number;
    controllerName?: string;
    /** DDP destination. Default 127.0.0.1 (the mock). */
    controllerIp?: string;
    /** Make the controller E1.31 with these universes; `channels` becomes their total. */
    e131Universes?: { universe: number; size: number }[];
}

export interface FixtureShow {
    dir: string;
    channels: number;
    controllerName: string;
    cleanup(): Promise<void>;
}

export async function createFixtureShow(opts: FixtureShowOptions = {}): Promise<FixtureShow> {
    const universes = opts.e131Universes;
    const channels = universes ? universes.reduce((n, u) => n + u.size, 0) : (opts.channels ?? 150);
    const pixels = Math.floor(channels / 3);
    const name = opts.controllerName ?? 'Moc';
    const ip = opts.controllerIp ?? '127.0.0.1';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-show-'));

    const protocol = universes ? 'E131' : 'DDP';
    const networkLines = universes
        ? universes.map(
              (u) =>
                  `<network ComPort="${ip}" BaudRate="${u.universe}" NetworkType="E131" MaxChannels="${u.size}" Enabled="Yes"/>`,
          )
        : [
              `<network ChannelsPerPacket="1440" KeepChannelNumbers="1" ComPort="${ip}" BaudRate="1" NetworkType="DDP" MaxChannels="${channels}"/>`,
          ];

    const networks = `<?xml version="1.0" encoding="UTF-8"?>
<Networks computer="test" GlobalFPPProxy="" GlobalForceLocalIP="" AutoUpdateFromBase="0" BaseShowDir="">
  <Controller Id="1" Name="${name}" Description="" Type="Ethernet" Vendor="FPP" Model="" Variant="" AutoSize="1" FromBase="0" ActiveState="Active" AutoLayout="1" AutoUpload="0" SuppressDuplicates="0" Monitor="0" IP="${ip}" Protocol="${protocol}" FPPProxy="" Priority="100" Version="1" Expanded="FALSE" UPS="FALSE" ForceLocalIP="">
    ${networkLines.join('\n    ')}
  </Controller>
</Networks>
`;

    const rgbeffects = `<?xml version="1.0" encoding="UTF-8"?>
<xrgb>
  <models>
    <model name="Line1" DisplayAs="Single Line" StringType="RGB Nodes" parm1="1" parm2="${pixels}" parm3="1" StartChannel="!${name}:1" Dir="L" Antialias="1" PixelSize="2" Transparency="0" LayoutGroup="Default" Controller="${name}" WorldPosX="0" WorldPosY="0" WorldPosZ="0" ScaleX="1" ScaleY="1" ScaleZ="1" RotateX="0" RotateY="0" RotateZ="0" versionNumber="7" StartSide="B"/>
  </models>
  <layoutGroups/>
  <viewpoints/>
  <colors/>
  <view_objects/>
  <effects version="0006"/>
  <palettes/>
</xrgb>
`;

    await fsp.writeFile(path.join(dir, 'xlights_networks.xml'), networks);
    await fsp.writeFile(path.join(dir, 'xlights_rgbeffects.xml'), rgbeffects);

    return {
        dir,
        channels,
        controllerName: name,
        cleanup: async () => {
            await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5 });
        },
    };
}
