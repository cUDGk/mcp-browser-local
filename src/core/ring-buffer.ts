export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly maxSize: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  values(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}
