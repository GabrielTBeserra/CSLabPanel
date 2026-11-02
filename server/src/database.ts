import { Pool, type PoolConfig } from "pg";

export interface DatabaseHealthProbe {
  ping(): Promise<void>;
}

export class PostgresDatabase implements DatabaseHealthProbe {
  private readonly pool: Pool;

  constructor(configuration: PoolConfig) {
    this.pool = new Pool({
      ...configuration,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
    });

    this.pool.on("error", (error) => {
      console.error(`[database] idle client error (${error.name})`);
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
