// app/storage.js
class MemoryStorage {
    constructor() {
        this.users = {};
        this.farms = {};
        this.progress = {};
    }
    
    getOrCreateUser(telegramId, userData) {
        if (!this.users[telegramId]) {
            this.users[telegramId] = {
                id: telegramId,
                ...userData,
                level: 1,
                coins: 100,
                experience: 0,
                lessonsCompleted: 0,
                completedLessonIds: [],
                streak: 1,
                createdAt: new Date().toISOString()
            };
        }
        return this.users[telegramId];
    }
    
    getUser(userId) {
        return this.users[userId];
    }
    
    updateUser(userId, updates) {
        if (this.users[userId]) {
            this.users[userId] = { ...this.users[userId], ...updates };
        }
        return this.users[userId];
    }
    
    getUserProgress(userId) {
        return {
            userId: userId,
            lessonsCompleted: this.users[userId]?.lessonsCompleted || 0,
            completedLessonIds: this.users[userId]?.completedLessonIds || []
        };
    }
    
    getFarm(userId) {
        if (!this.farms[userId]) {
            this.farms[userId] = {
                userId: userId,
                cells: Array(64).fill('grass'),
                buildings: 0,
                crops: 0,
                water: 0,
                cleared: 0
            };
        }
        return this.farms[userId];
    }
    
    updateFarm(userId, updates) {
        if (this.farms[userId]) {
            this.farms[userId] = { ...this.farms[userId], ...updates };
        }
        return this.farms[userId];
    }
}

module.exports = MemoryStorage;
