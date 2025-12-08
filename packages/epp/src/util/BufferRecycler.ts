function roundSizeToTwoBitBinary(size: number): number {
  if (size <= 64) return 64;

  const bin = 1 << (32 - Math.clz32(size - 1));
  const shrink = bin - (bin >> 2);

  if (shrink >= size) {
    return shrink;
  } else {
    return bin;
  }
}

type BucketInfo<B> = {
  size: number;
  pool: B[];
  allocated: number; // Total ever allocated
};

abstract class ABufferPool<B> {
  private buckets: Map<number, BucketInfo<B>> = new Map();

  abstract alloc(n: number): B;
  abstract getLength(b: B): number;

  /** Round up to the nearest configured bucket size */
  private getBucketSize(requestedSize: number): number {
    const bs = roundSizeToTwoBitBinary(requestedSize);
    //console.log(`${requestedSize}->${bs}`);
    return bs;
  }

  /** Request a buffer of at least the given size */
  get(size: number): B {
    const bucketSize = this.getBucketSize(size);
    if (!this.buckets.has(bucketSize)) {
      this.buckets.set(bucketSize, {
        size: bucketSize,
        pool: [],
        allocated: 0,
      });
    }
    const bucket = this.buckets.get(bucketSize)!;

    const buf = bucket.pool.pop();
    if (buf) return buf;

    const b = this.alloc(bucketSize);
    bucket.allocated++;
    return b;
  }

  /** Return a buffer to the pool */
  release(buf: B): void {
    const size = this.getLength(buf);
    const bucket = this.buckets.get(size);
    if (bucket) {
      bucket.pool.push(buf);
    } else {
      // Not from a known bucket — discard or track separately if you want
      // Could warn here if desired
    }
  }

  /** Diagnostic: report memory usage */
  getStats(): {
    size: number;
    inUse: number;
    inPool: number;
    total: number;
  }[] {
    const result: {
      size: number;
      inUse: number;
      inPool: number;
      total: number;
    }[] = [];

    for (const bucket of this.buckets.values()) {
      result.push({
        size: bucket.size,
        inUse: bucket.allocated - bucket.pool.length,
        inPool: bucket.pool.length,
        total: bucket.allocated,
      });
    }

    return result.sort((a, b) => a.size - b.size);
  }
}

export class BufferPool extends ABufferPool<Buffer> {
  alloc(n: number): Buffer<ArrayBufferLike> {
    return Buffer.allocUnsafe(n);
  }
  getLength(b: Buffer): number {
    return b.byteLength;
  }
}

export class ArrayBufferPool extends ABufferPool<ArrayBuffer> {
  alloc(n: number) {
    return new ArrayBuffer(n);
  }
  getLength(b: ArrayBuffer): number {
    return b.byteLength;
  }
}