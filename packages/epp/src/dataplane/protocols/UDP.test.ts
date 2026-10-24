import { expect, it } from 'vitest';
import { UdpClient } from './UDP';

it('does not strand a replacement sender when its first frame ends without a batch', async () => {
    const client = new UdpClient('udp4', '127.0.0.1', 4048);
    // A sender opened between startBatch and endBatch has no batch for that frame.
    expect(client.endSendBatch()).toBeUndefined();
    expect(client.batchesInFlight).toBe(0);
    client.startSendBatch();
    const batch = client.endSendBatch();
    await batch!.promise;
    expect(client.batchesInFlight).toBe(0);
    expect(client.endSendBatch()).toBeUndefined();
    expect(client.batchesInFlight).toBe(0);
});
