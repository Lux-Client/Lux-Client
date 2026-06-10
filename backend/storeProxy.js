let storeInstance = null;

import('electron-store').then(({ default: Store }) => {
    storeInstance = new Store();
}).catch(console.error);

const storeProxy = new Proxy({}, {
    get(target, prop) {
        if (!storeInstance) {
            throw new Error(`electron-store accessed before initialization.`);
        }
        if (typeof storeInstance[prop] === 'function') {
            return storeInstance[prop].bind(storeInstance);
        }
        return storeInstance[prop];
    }
});

module.exports = storeProxy;
