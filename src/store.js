const fs = require('fs');
const path = require('path');
const createDebug = require('debug');

const debug = createDebug('app:store');

class LearningStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.legacyFilePath = filePath;
    this.storageDir = process.env.MEMORY_DIR || path.join(path.dirname(filePath), 'memory');
    this.shardPaths = {
      core: path.join(this.storageDir, 'core.json'),
      interactions: path.join(this.storageDir, 'interactions.json'),
      language: path.join(this.storageDir, 'language.json'),
      knowledge: path.join(this.storageDir, 'knowledge.json'),
      neural: path.join(this.storageDir, 'neural.json')
    };

    this.state = this.getInitialState();
    this.saveTimer = null;
    this.firstDirtyAt = null;
    this.isPersisting = false;
    this.persistQueued = false;
    this.dirtyShards = new Set(['core', 'interactions', 'language', 'knowledge', 'neural']);

    const debounceMs = Number(process.env.MEMORY_SAVE_DEBOUNCE_MS || 1800);
    const maxBufferMs = Number(process.env.MEMORY_SAVE_MAX_BUFFER_MS || 12000);
    this.saveDebounceMs = Number.isFinite(debounceMs) && debounceMs >= 100 ? debounceMs : 1800;
    this.saveMaxBufferMs = Number.isFinite(maxBufferMs) && maxBufferMs >= 500 ? maxBufferMs : 12000;
    this.prettyPrint = String(process.env.MEMORY_JSON_PRETTY || 'false').toLowerCase() === 'true';
  }

  getShardPayload(shardName) {
    if (shardName === 'core') {
      return {
        version: this.state.version,
        createdAt: this.state.createdAt,
        stats: this.state.stats,
        sessions: this.state.sessions,
        trainer: this.state.trainer
      };
    }

    if (shardName === 'interactions') {
      return {
        interactions: this.state.interactions
      };
    }

    if (shardName === 'language') {
      return {
        tokenGraph: this.state.tokenGraph,
        responseBank: this.state.responseBank,
        conceptGraph: this.state.conceptGraph,
        associationGraph: this.state.associationGraph
      };
    }

    if (shardName === 'knowledge') {
      return {
        learnedFacts: this.state.learnedFacts,
        webKnowledge: this.state.webKnowledge,
        starterLessons: this.state.starterLessons
      };
    }

    if (shardName === 'neural') {
      return {
        neural: this.state.neural
      };
    }

    return {};
  }

  async readJsonIfExists(filePath, fallback = null) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return fallback;
      }
      throw error;
    }
  }

  markDirty(shards) {
    const list = Array.isArray(shards) && shards.length ? shards : ['core', 'interactions', 'language', 'knowledge', 'neural'];
    for (const shard of list) {
      if (this.shardPaths[shard]) {
        this.dirtyShards.add(shard);
      }
    }
  }

  getInitialState() {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      stats: {
        messages: 0,
        sessions: 0,
        trainerIterations: 0,
        trainerProcessedInteractions: 0,
        webIngestions: 0,
        mentorGuidances: 0,
        starterLessonsLoaded: 0
      },
      sessions: {},
      interactions: [],
      tokenGraph: {},
      responseBank: {},
      learnedFacts: {},
      conceptGraph: {},
      associationGraph: {},
      webKnowledge: {},
      starterLessons: {},
      neural: {
        dim: 48,
        trainedSamples: 0,
        lastTrainAt: null,
        prototypes: []
      },
      trainer: {
        processedUntil: 0,
        lastRunAt: null
      }
    };
  }

  async init() {
    await fs.promises.mkdir(path.dirname(this.legacyFilePath), { recursive: true });
    await fs.promises.mkdir(this.storageDir, { recursive: true });

    const initial = this.getInitialState();
    const shardCore = await this.readJsonIfExists(this.shardPaths.core, null);

    if (shardCore) {
      const shardInteractions = await this.readJsonIfExists(this.shardPaths.interactions, {});
      const shardLanguage = await this.readJsonIfExists(this.shardPaths.language, {});
      const shardKnowledge = await this.readJsonIfExists(this.shardPaths.knowledge, {});
      const shardNeural = await this.readJsonIfExists(this.shardPaths.neural, {});

      this.state = {
        ...initial,
        ...shardCore,
        ...shardInteractions,
        ...shardLanguage,
        ...shardKnowledge,
        ...shardNeural,
        stats: {
          ...initial.stats,
          ...(shardCore.stats || {})
        },
        neural: {
          ...initial.neural,
          ...(shardNeural.neural || {})
        },
        trainer: {
          ...initial.trainer,
          ...(shardCore.trainer || {})
        }
      };

      this.dirtyShards.clear();
      debug('Loaded sharded memory with %d interactions', this.state.interactions.length);
      return;
    }

    try {
      const raw = await fs.promises.readFile(this.legacyFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...initial,
        ...parsed,
        stats: {
          ...initial.stats,
          ...(parsed.stats || {})
        },
        neural: {
          ...initial.neural,
          ...(parsed.neural || {})
        },
        trainer: {
          ...initial.trainer,
          ...(parsed.trainer || {})
        }
      };

      this.markDirty(['core', 'interactions', 'language', 'knowledge', 'neural']);
      await this.persist();
      debug('Migrated legacy memory file to sharded format');
      return;
    } catch (error) {
      if (error instanceof SyntaxError) {
        const corruptPath = `${this.legacyFilePath}.corrupt-${Date.now()}`;
        try {
          await fs.promises.rename(this.legacyFilePath, corruptPath);
          debug('Legacy memory file was corrupt and moved to %s', corruptPath);
        } catch (renameError) {
          debug('Failed to move corrupt legacy memory file: %O', renameError);
        }

        this.state = initial;
        this.markDirty(['core', 'interactions', 'language', 'knowledge', 'neural']);
        await this.persist();
        return;
      }

      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    debug('No memory file found. Starting from scratch.');
    this.state = initial;
    this.markDirty(['core', 'interactions', 'language', 'knowledge', 'neural']);
    await this.persist();
  }

  scheduleSave(shards = null) {
    this.markDirty(shards);

    const now = Date.now();
    if (!this.firstDirtyAt) {
      this.firstDirtyAt = now;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    const elapsed = now - this.firstDirtyAt;
    const delay = elapsed >= this.saveMaxBufferMs ? 0 : this.saveDebounceMs;

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch((error) => {
        debug('Failed to persist store: %O', error);
      });
    }, delay);
  }

  async persist(force = false) {
    if (this.isPersisting) {
      this.persistQueued = true;
      return;
    }

    this.isPersisting = true;
    try {
      const shardList = force
        ? Object.keys(this.shardPaths)
        : [...this.dirtyShards].filter((name) => this.shardPaths[name]);

      if (shardList.length === 0) {
        this.firstDirtyAt = null;
        return;
      }

      for (const shardName of shardList) {
        const targetPath = this.shardPaths[shardName];
        const tempPath = `${targetPath}.tmp`;
        const payload = this.prettyPrint
          ? JSON.stringify(this.getShardPayload(shardName), null, 2)
          : JSON.stringify(this.getShardPayload(shardName));

        await fs.promises.writeFile(tempPath, payload, 'utf8');
        await fs.promises.rename(tempPath, targetPath);
        this.dirtyShards.delete(shardName);
      }

      this.firstDirtyAt = null;
      debug('Persisted memory shards: %o', shardList);
    } finally {
      this.isPersisting = false;
      if (this.persistQueued) {
        this.persistQueued = false;
        await this.persist();
      }
    }
  }
}

module.exports = LearningStore;