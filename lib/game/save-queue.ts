/** Coalesce pending requests; a failure ends the batch until an explicit retry. */
export class SaveQueue {
    private pending = false;
    private running: Promise<void> | null = null;
    request(write: () => Promise<boolean>): Promise<void> {
        this.pending = true;
        if (!this.running) {
            // Defer execution so running is assigned before write can reenter request.
            this.running = Promise.resolve().then(async () => {
                try {
                    while (this.pending) {
                        this.pending = false;
                        if (!(await write()))
                            break;
                    }
                }
                finally {
                    this.pending = false;
                    this.running = null;
                }
            });
        }
        return this.running;
    }
}
