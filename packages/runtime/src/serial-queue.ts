export class SerialQueue {
  private tail = Promise.resolve();

  constructor(
    private readonly beforeOperation?: () => void | Promise<void>,
    private readonly maxConflictRetries = 0,
    private readonly isConflict: (error: unknown) => boolean = () => false,
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        await this.beforeOperation?.();
        try {
          return await operation();
        } catch (error) {
          if (!this.isConflict(error) || attempt >= this.maxConflictRetries) {
            throw error;
          }
        }
      }
    };
    const result = this.tail.then(execute, execute);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
