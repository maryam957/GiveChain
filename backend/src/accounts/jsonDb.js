// Small JSON-file database for accounts, sessions and applications.
//
// Why a file and not PostgreSQL: this is a local prototype, and a file needs no
// installation. Writes go to a temporary file first and are then renamed, so a crash
// can never leave a half-written database. For production, replace this module with
// a real database; the rest of the code only uses the methods below.

const fs = require("fs");
const path = require("path");

const EMPTY = { users: [], sessions: [], roleApplications: [], beneficiaryApplications: [], walletNonces: [] };

class JsonDb {
    constructor(file) {
        this.file = file;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.data = structuredClone(EMPTY);
        if (fs.existsSync(file)) {
            const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
            this.data = { ...structuredClone(EMPTY), ...loaded };
        }
    }

    /** Persists the whole database atomically. */
    save() {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        fs.renameSync(tmp, this.file);
    }

    collection(name) {
        return this.data[name];
    }
}

/** In-memory variant for tests. */
class MemoryDb extends JsonDb {
    constructor() {
        super(path.join(require("os").tmpdir(), `givechain-memdb-${process.pid}-${Date.now()}-${Math.random()}.json`));
    }
    save() {}
}

module.exports = { JsonDb, MemoryDb };
