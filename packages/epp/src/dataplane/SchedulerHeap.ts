export interface SchedulerHeapItem {
    nextTime: number;
}

export class SchedulerMinHeap<T extends SchedulerHeapItem> {
    private heap: T[];

    constructor() {
        this.heap = [];
    }

    get top(): T | undefined {
        return this.heap[0]; // Peek at the top element
    }

    updateTop(updateFn: (item: T) => void): void {
        if (this.heap.length === 0) return;

        updateFn(this.heap[0]); // Modify the top element
        this.bubbleDown(0); // Restore heap order
    }

    insert(item: T): void {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.heap[index].nextTime >= this.heap[parentIndex].nextTime) break;
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        const lastIndex = this.heap.length - 1;
        while (true) {
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            let smallest = index;
    
            if (left <= lastIndex && this.heap[left].nextTime < this.heap[smallest].nextTime) {
                smallest = left;
            }
            if (right <= lastIndex && this.heap[right].nextTime< this.heap[smallest].nextTime) {
                smallest = right;
            }
            if (smallest === index) break;
    
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
}
