class Farm3DEngine {
    constructor(containerId, userId) {
        this.containerId = containerId;
        this.userId = userId;
        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.farmSize = 16;
        this.cellSize = 2;
        this.objects = new Map();
        this.animations = [];
        this.currentLesson = null;
        
        // Текстуры и материалы
        this.materials = {
            grass: null,
            soil: null,
            water: null,
            wood: null,
            stone: null,
            crop: null
        };
        
        // Модели
        this.models = {
            house: null,
            barn: null,
            tractor: null,
            well: null,
            wheat: null,
            carrot: null,
            tree: null,
            fence: null
        };
    }
    
    async init() {
        try {
            console.log('🚀 Инициализация 3D фермы...');
            
            // Контейнер
            this.container = document.getElementById(this.containerId);
            if (!this.container) {
                throw new Error(`Контейнер ${this.containerId} не найден`);
            }
            
            // Сцена
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x87CEEB);
            
            // Камера
            const aspect = this.container.clientWidth / this.container.clientHeight;
            this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
            this.camera.position.set(25, 15, 25);
            this.camera.lookAt(0, 0, 0);
            
            // Рендерер
            this.renderer = new THREE.WebGLRenderer({ 
                antialias: true,
                alpha: true 
            });
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.container.appendChild(this.renderer.domElement);
            
            // Управление камерой
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 5;
            this.controls.maxDistance = 50;
            
            // Освещение
            this.setupLighting();
            
            // Загружаем текстуры и модели
            await this.loadAssets();
            
            // Создаем ферму
            this.createGround();
            this.createSky();
            this.createInitialFarm();
            
            // Запускаем анимацию
            this.animate();
            
            // Обработка ресайза
            window.addEventListener('resize', () => this.onResize());
            
            console.log('✅ 3D ферма инициализирована');
            
        } catch (error) {
            console.error('❌ Ошибка инициализации 3D фермы:', error);
            this.showFallback();
        }
    }
    
    async loadAssets() {
        console.log('📦 Загрузка ассетов для фермы...');
        
        // Простые материалы для начала
        const textureLoader = new THREE.TextureLoader();
        
        this.materials = {
            grass: new THREE.MeshLambertMaterial({ 
                color: 0x7CFC00,
                roughness: 0.8
            }),
            soil: new THREE.MeshLambertMaterial({ 
                color: 0x8B4513,
                roughness: 0.9
            }),
            water: new THREE.MeshLambertMaterial({ 
                color: 0x4682B4,
                transparent: true,
                opacity: 0.7
            }),
            wood: new THREE.MeshLambertMaterial({ 
                color: 0xDEB887,
                roughness: 0.7
            }),
            stone: new THREE.MeshLambertMaterial({ 
                color: 0xA9A9A9,
                roughness: 0.6
            }),
            crop: new THREE.MeshLambertMaterial({ 
                color: 0x32CD32,
                roughness: 0.8
            })
        };
        
        // Простые геометрические модели
        this.models = {
            house: this.createHouseModel(),
            barn: this.createBarnModel(),
            tractor: this.createTractorModel(),
            well: this.createWellModel(),
            wheat: this.createWheatModel(),
            carrot: this.createCarrotModel(),
            tree: this.createTreeModel(),
            fence: this.createFenceSegment()
        };
        
        console.log('✅ Ассеты загружены');
    }
    
    createHouseModel() {
        const group = new THREE.Group();
        
        // Фундамент
        const foundation = new THREE.Mesh(
            new THREE.BoxGeometry(3, 0.5, 3),
            this.materials.stone
        );
        foundation.position.y = 0.25;
        group.add(foundation);
        
        // Стены
        const walls = new THREE.Mesh(
            new THREE.BoxGeometry(2.8, 2, 2.8),
            this.materials.wood
        );
        walls.position.y = 1.5;
        group.add(walls);
        
        // Крыша
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(2.2, 1.5, 4),
            new THREE.MeshLambertMaterial({ color: 0x8B0000 })
        );
        roof.position.y = 3.25;
        roof.rotation.y = Math.PI / 4;
        group.add(roof);
        
        // Дверь
        const door = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.5, 0.1),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        door.position.set(0, 0.75, 1.45);
        group.add(door);
        
        // Окна
        for (let i = -1; i <= 1; i += 2) {
            const window = new THREE.Mesh(
                new THREE.BoxGeometry(0.6, 0.6, 0.1),
                new THREE.MeshLambertMaterial({ color: 0x87CEEB })
            );
            window.position.set(i * 0.8, 1.5, 1.45);
            group.add(window);
        }
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    createBarnModel() {
        const group = new THREE.Group();
        
        // Основная часть
        const main = new THREE.Mesh(
            new THREE.BoxGeometry(4, 3, 4),
            this.materials.wood
        );
        main.position.y = 1.5;
        group.add(main);
        
        // Крыша
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(3.5, 2, 4),
            new THREE.MeshLambertMaterial({ color: 0x8B0000 })
        );
        roof.position.y = 4;
        roof.rotation.y = Math.PI / 4;
        group.add(roof);
        
        // Двери
        const door = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2.5, 0.1),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        door.position.set(0, 1.25, 2.06);
        group.add(door);
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    createTractorModel() {
        const group = new THREE.Group();
        
        // Кабина
        const cab = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1.2, 1.2),
            new THREE.MeshLambertMaterial({ color: 0xFF4500 })
        );
        cab.position.y = 0.8;
        group.add(cab);
        
        // Двигатель
        const engine = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 0.8, 1),
            new THREE.MeshLambertMaterial({ color: 0x2F4F4F })
        );
        engine.position.set(0.9, 0.5, 0);
        group.add(engine);
        
        // Колеса
        const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16);
        const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        // Передние колеса
        const frontWheel1 = new THREE.Mesh(wheelGeometry, wheelMaterial);
        frontWheel1.rotation.z = Math.PI / 2;
        frontWheel1.position.set(-0.8, 0.5, 0.8);
        group.add(frontWheel1);
        
        const frontWheel2 = new THREE.Mesh(wheelGeometry, wheelMaterial);
        frontWheel2.rotation.z = Math.PI / 2;
        frontWheel2.position.set(-0.8, 0.5, -0.8);
        group.add(frontWheel2);
        
        // Задние колеса
        const backWheel1 = new THREE.Mesh(wheelGeometry, wheelMaterial);
        backWheel1.rotation.z = Math.PI / 2;
        backWheel1.position.set(1.2, 0.5, 0.8);
        group.add(backWheel1);
        
        const backWheel2 = new THREE.Mesh(wheelGeometry, wheelMaterial);
        backWheel2.rotation.z = Math.PI / 2;
        backWheel2.position.set(1.2, 0.5, -0.8);
        group.add(backWheel2);
        
        // Выхлопная труба
        const exhaust = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8),
            new THREE.MeshLambertMaterial({ color: 0x696969 })
        );
        exhaust.position.set(1.5, 1.2, 0);
        group.add(exhaust);
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    createWellModel() {
        const group = new THREE.Group();
        
        // Основание
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.2, 1.2, 0.5, 16),
            this.materials.stone
        );
        base.position.y = 0.25;
        group.add(base);
        
        // Столб колодца
        const column = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            this.materials.stone
        );
        column.position.y = 1.5;
        group.add(column);
        
        // Крыша
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(1.5, 1, 4),
            this.materials.wood
        );
        roof.position.y = 3;
        roof.rotation.y = Math.PI / 4;
        group.add(roof);
        
        // Ворот
        const windlass = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, 1.5, 8),
            this.materials.wood
        );
        windlass.position.y = 2;
        windlass.rotation.z = Math.PI / 2;
        group.add(windlass);
        
        // Ведро
        const bucket = new THREE.Mesh(
            new THREE.ConeGeometry(0.3, 0.4, 8),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        bucket.position.set(0.8, 1, 0);
        bucket.rotation.x = Math.PI;
        group.add(bucket);
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    createWheatModel() {
        const group = new THREE.Group();
        
        // Стебель
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
            new THREE.MeshLambertMaterial({ color: 0x228B22 })
        );
        stem.position.y = 0.5;
        group.add(stem);
        
        // Колос
        const head = new THREE.Mesh(
            new THREE.ConeGeometry(0.15, 0.4, 8),
            new THREE.MeshLambertMaterial({ color: 0xDAA520 })
        );
        head.position.y = 1.2;
        group.add(head);
        
        // Листья
        for (let i = 0; i < 3; i++) {
            const leaf = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.05, 0.5),
                new THREE.MeshLambertMaterial({ color: 0x32CD32 })
            );
            leaf.position.set(0, 0.3 + i * 0.2, 0);
            leaf.rotation.z = Math.PI / 4;
            group.add(leaf);
        }
        
        return group;
    }
    
    createCarrotModel() {
        const group = new THREE.Group();
        
        // Корнеплод
        const root = new THREE.Mesh(
            new THREE.ConeGeometry(0.2, 0.6, 8),
            new THREE.MeshLambertMaterial({ color: 0xFF8C00 })
        );
        root.position.y = 0.3;
        group.add(root);
        
        // Ботва
        const top = new THREE.Mesh(
            new THREE.ConeGeometry(0.3, 0.4, 8),
            new THREE.MeshLambertMaterial({ color: 0x32CD32 })
        );
        top.position.y = 0.8;
        top.rotation.x = Math.PI;
        group.add(top);
        
        return group;
    }
    
    createTreeModel() {
        const group = new THREE.Group();
        
        // Ствол
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.4, 3, 8),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        trunk.position.y = 1.5;
        group.add(trunk);
        
        // Крона
        const crown = new THREE.Mesh(
            new THREE.SphereGeometry(2, 8, 8),
            new THREE.MeshLambertMaterial({ color: 0x228B22 })
        );
        crown.position.y = 4;
        group.add(crown);
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    createFenceSegment() {
        const group = new THREE.Group();
        
        // Столбы
        const post1 = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8),
            this.materials.wood
        );
        post1.position.set(-0.5, 0.75, 0);
        group.add(post1);
        
        const post2 = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8),
            this.materials.wood
        );
        post2.position.set(0.5, 0.75, 0);
        group.add(post2);
        
        // Перекладины
        const rail1 = new THREE.Mesh(
            new THREE.BoxGeometry(1, 0.1, 0.1),
            this.materials.wood
        );
        rail1.position.y = 0.4;
        group.add(rail1);
        
        const rail2 = new THREE.Mesh(
            new THREE.BoxGeometry(1, 0.1, 0.1),
            this.materials.wood
        );
        rail2.position.y = 1.1;
        group.add(rail2);
        
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
            }
        });
        
        return group;
    }
    
    setupLighting() {
        // Солнце (направленный свет)
        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(50, 100, 50);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 500;
        sunLight.shadow.camera.left = -100;
        sunLight.shadow.camera.right = 100;
        sunLight.shadow.camera.top = 100;
        sunLight.shadow.camera.bottom = -100;
        this.scene.add(sunLight);
        
        // Рассеянный свет
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        
        // Заполняющий свет
        const fillLight = new THREE.HemisphereLight(0x87CEEB, 0x2F4F4F, 0.3);
        this.scene.add(fillLight);
    }
    
    createGround() {
        // Трава
        const groundGeometry = new THREE.PlaneGeometry(
            this.farmSize * this.cellSize, 
            this.farmSize * this.cellSize
        );
        const ground = new THREE.Mesh(groundGeometry, this.materials.grass);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Сетка для ориентации
        const gridHelper = new THREE.GridHelper(
            this.farmSize * this.cellSize, 
            this.farmSize,
            0x000000,
            0x000000
        );
        gridHelper.material.opacity = 0.1;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
        
        // Периметр фермы (граница)
        this.createFarmPerimeter();
    }
    
    createFarmPerimeter() {
        const perimeterSize = this.farmSize * this.cellSize / 2;
        
        // Создаем забор по периметру
        for (let i = -perimeterSize + 1; i < perimeterSize; i += 2) {
            // Верхняя граница
            const topFence = this.models.fence.clone();
            topFence.position.set(i, 0, perimeterSize - 1);
            this.scene.add(topFence);
            
            // Нижняя граница
            const bottomFence = this.models.fence.clone();
            bottomFence.position.set(i, 0, -perimeterSize + 1);
            this.scene.add(bottomFence);
            
            // Левая граница
            const leftFence = this.models.fence.clone();
            leftFence.rotation.y = Math.PI / 2;
            leftFence.position.set(-perimeterSize + 1, 0, i);
            this.scene.add(leftFence);
            
            // Правая граница
            const rightFence = this.models.fence.clone();
            rightFence.rotation.y = Math.PI / 2;
            rightFence.position.set(perimeterSize - 1, 0, i);
            this.scene.add(rightFence);
        }
    }
    
    createSky() {
        // Простое небо
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87CEEB,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
    }
    
    createInitialFarm() {
        console.log('🌾 Создаем начальную ферму...');
        
        // Создаем клеточную сетку
        const grid = [];
        const halfSize = this.farmSize / 2;
        
        for (let x = -halfSize; x < halfSize; x++) {
            for (let z = -halfSize; z < halfSize; z++) {
                const cell = {
                    x: x * this.cellSize,
                    z: z * this.cellSize,
                    type: 'grass',
                    object: null,
                    growth: 0
                };
                grid.push(cell);
                
                // Создаем траву (пока просто зеленая плоскость)
                const grassPatch = new THREE.Mesh(
                    new THREE.PlaneGeometry(this.cellSize - 0.1, this.cellSize - 0.1),
                    this.materials.grass
                );
                grassPatch.rotation.x = -Math.PI / 2;
                grassPatch.position.set(cell.x, 0.01, cell.z);
                this.scene.add(grassPatch);
                
                cell.object = grassPatch;
                this.objects.set(`${x},${z}`, cell);
            }
        }
        
        // Добавляем несколько деревьев для красоты
        this.addRandomTrees();
        
        console.log(`✅ Ферма создана: ${grid.length} клеток`);
    }
    
    addRandomTrees() {
        const treePositions = [
            [-12, -12], [12, -12], [-12, 12], [12, 12],
            [-8, -8], [8, -8], [-8, 8], [8, 8]
        ];
        
        treePositions.forEach(([x, z]) => {
            const tree = this.models.tree.clone();
            tree.position.set(x, 0, z);
            this.scene.add(tree);
        });
    }
    
    // === ОСНОВНЫЕ МЕТОДЫ ДЛЯ УРОКОВ ===
    
    applyLessonEffect(lessonId) {
        console.log(`🎯 Применяем эффект урока: ${lessonId}`);
        
        switch(lessonId) {
            case 'lesson_1':
                this.clearFarm();
                break;
                
            case 'lesson_2':
                this.buildHouse();
                break;
                
            case 'lesson_3':
                this.createTractor();
                break;
                
            case 'lesson_4':
                this.plowFields();
                break;
                
            case 'lesson_5':
                this.plantCrops();
                break;
                
            case 'lesson_6':
                this.createWaterWell();
                break;
                
            default:
                console.log(`⚠️ Неизвестный урок: ${lessonId}`);
        }
    }
    
    clearFarm() {
        console.log('🧹 Расчищаем ферму...');
        
        // Превращаем все клетки в расчищенную землю
        this.objects.forEach((cell, key) => {
            if (cell.type === 'grass' && cell.object) {
                // Меняем материал на почву
                cell.object.material = this.materials.soil;
                cell.type = 'soil';
                
                // Анимация очистки
                this.animateClear(cell.object);
            }
        });
        
        // Создаем дорожки
        this.createPaths();
        
        // Анимация завершения
        this.playCelebration();
    }
    
    buildHouse() {
        console.log('🏠 Строим дом...');
        
        const house = this.models.house.clone();
        house.position.set(0, 0, 0);
        house.scale.set(1.5, 1.5, 1.5);
        this.scene.add(house);
        
        // Анимация строительства
        this.animateBuild(house);
        
        // Освобождаем клетки под домом
        const houseCells = [[0,0], [0,1], [1,0], [1,1]];
        houseCells.forEach(([dx, dz]) => {
            const cell = this.objects.get(`${dx},${dz}`);
            if (cell && cell.object) {
                this.scene.remove(cell.object);
                cell.type = 'house';
            }
        });
    }
    
    createTractor() {
        console.log('🚜 Создаем трактор...');
        
        const tractor = this.models.tractor.clone();
        tractor.position.set(-8, 0, -8);
        tractor.rotation.y = Math.PI / 4;
        this.scene.add(tractor);
        
        // Анимация движения трактора
        this.animateTractor(tractor);
    }
    
    plowFields() {
        console.log('🔄 Вспахиваем поля...');
        
        // Вспахиваем несколько полей
        const fieldPositions = [
            [-4, -4], [-2, -4], [0, -4], [2, -4],
            [-4, -2], [-2, -2], [0, -2], [2, -2]
        ];
        
        fieldPositions.forEach(([x, z], index) => {
            setTimeout(() => {
                const cell = this.objects.get(`${x},${z}`);
                if (cell && cell.object) {
                    // Создаем эффект вспаханного поля
                    const plowedSoil = new THREE.Mesh(
                        new THREE.PlaneGeometry(this.cellSize - 0.2, this.cellSize - 0.2),
                        new THREE.MeshLambertMaterial({ 
                            color: 0x8B4513,
                            roughness: 1
                        })
                    );
                    plowedSoil.rotation.x = -Math.PI / 2;
                    plowedSoil.position.set(cell.x, 0.02, cell.z);
                    
                    // Добавляем текстуру борозд
                    const lines = new THREE.Mesh(
                        new THREE.PlaneGeometry(this.cellSize - 0.3, this.cellSize - 0.3),
                        new THREE.MeshLambertMaterial({ 
                            color: 0x654321,
                            transparent: true,
                            opacity: 0.3
                        })
                    );
                    lines.rotation.x = -Math.PI / 2;
                    lines.position.set(cell.x, 0.03, cell.z);
                    
                    this.scene.add(plowedSoil);
                    this.scene.add(lines);
                    
                    cell.type = 'plowed';
                    cell.plowedObject = plowedSoil;
                }
            }, index * 200);
        });
    }
    
    plantCrops() {
        console.log('🌱 Сажаем культуры...');
        
        // Находим вспаханные поля
        const plowedCells = Array.from(this.objects.values())
            .filter(cell => cell.type === 'plowed')
            .slice(0, 6); // Максимум 6 полей
        
        plowedCells.forEach((cell, index) => {
            setTimeout(() => {
                // Создаем грядку
                const bed = new THREE.Group();
                
                // Сажаем несколько растений на грядке
                for (let i = -1; i <= 1; i += 2) {
                    for (let j = -1; j <= 1; j += 2) {
                        const plant = Math.random() > 0.5 
                            ? this.models.wheat.clone() 
                            : this.models.carrot.clone();
                        
                        plant.position.set(i * 0.3, 0, j * 0.3);
                        plant.scale.set(0.5, 0.5, 0.5);
                        bed.add(plant);
                    }
                }
                
                bed.position.set(cell.x, 0, cell.z);
                this.scene.add(bed);
                
                cell.type = 'crop';
                cell.cropObject = bed;
                
                // Анимация роста
                this.animateCropGrowth(bed);
                
            }, index * 300);
        });
    }
    
    createWaterWell() {
        console.log('💧 Создаем колодец...');
        
        const well = this.models.well.clone();
        well.position.set(10, 0, 10);
        well.scale.set(1.2, 1.2, 1.2);
        this.scene.add(well);
        
        // Создаем водоем рядом
        this.createPond(8, 8);
        
        // Анимация воды
        this.animateWater(well);
    }
    
    createPond(x, z) {
        const pondGeometry = new THREE.CylinderGeometry(2, 2, 0.2, 32);
        const pondMaterial = new THREE.MeshLambertMaterial({
            color: 0x4682B4,
            transparent: true,
            opacity: 0.8
        });
        const pond = new THREE.Mesh(pondGeometry, pondMaterial);
        pond.position.set(x, 0.1, z);
        pond.rotation.x = Math.PI / 2;
        this.scene.add(pond);
    }
    
    createPaths() {
        console.log('🛣️ Создаем дорожки...');
        
        const pathMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x8B7355,
            roughness: 0.9
        });
        
        // Основная дорожка от входа к дому
        const mainPath = new THREE.Mesh(
            new THREE.PlaneGeometry(12, 2),
            pathMaterial
        );
        mainPath.rotation.x = -Math.PI / 2;
        mainPath.position.set(0, 0.02, -6);
        this.scene.add(mainPath);
        
        // Дорожки к полям
        const fieldPath1 = new THREE.Mesh(
            new THREE.PlaneGeometry(8, 1),
            pathMaterial
        );
        fieldPath1.rotation.x = -Math.PI / 2;
        fieldPath1.position.set(-3, 0.02, -2);
        fieldPath1.rotation.y = Math.PI / 2;
        this.scene.add(fieldPath1);
        
        const fieldPath2 = new THREE.Mesh(
            new THREE.PlaneGeometry(8, 1),
            pathMaterial
        );
        fieldPath2.rotation.x = -Math.PI / 2;
        fieldPath2.position.set(3, 0.02, -2);
        fieldPath2.rotation.y = Math.PI / 2;
        this.scene.add(fieldPath2);
    }
    
    // === АНИМАЦИИ ===
    
    animateClear(object) {
        const startScale = object.scale.clone();
        object.scale.set(0.1, 0.1, 0.1);
        
        new TWEEN.Tween(object.scale)
            .to(startScale, 500)
            .easing(TWEEN.Easing.Elastic.Out)
            .start();
    }
    
    animateBuild(object) {
        object.scale.set(0.1, 0.1, 0.1);
        object.visible = true;
        
        new TWEEN.Tween(object.scale)
            .to({ x: 1.5, y: 1.5, z: 1.5 }, 1500)
            .easing(TWEEN.Easing.Elastic.Out)
            .start();
    }
    
    animateTractor(tractor) {
        const path = [
            { x: -8, z: -8 },
            { x: -4, z: -8 },
            { x: -4, z: -4 },
            { x: 0, z: -4 },
            { x: 0, z: 0 },
            { x: -8, z: 0 },
            { x: -8, z: -8 }
        ];
        
        let currentPoint = 0;
        
        const moveToNextPoint = () => {
            if (currentPoint >= path.length) {
                currentPoint = 0;
            }
            
            const target = path[currentPoint];
            
            new TWEEN.Tween(tractor.position)
                .to({ x: target.x, z: target.z }, 2000)
                .easing(TWEEN.Easing.Quadratic.InOut)
                .onUpdate(() => {
                    // Поворачиваем трактор в направлении движения
                    const direction = new THREE.Vector3()
                        .subVectors(target, tractor.position)
                        .normalize();
                    if (direction.length() > 0.1) {
                        tractor.rotation.y = Math.atan2(direction.x, direction.z);
                    }
                })
                .onComplete(() => {
                    currentPoint++;
                    moveToNextPoint();
                })
                .start();
        };
        
        moveToNextPoint();
    }
    
    animateCropGrowth(crop) {
        crop.scale.set(0.1, 0.1, 0.1);
        
        new TWEEN.Tween(crop.scale)
            .to({ x: 0.5, y: 0.5, z: 0.5 }, 2000)
            .easing(TWEEN.Easing.Elastic.Out)
            .start();
    }
    
    animateWater(well) {
        const bucket = well.children[4]; // Ведро
        
        new TWEEN.Tween(bucket.position)
            .to({ y: 0.5 }, 1000)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .yoyo(true)
            .repeat(Infinity)
            .start();
    }
    
    playCelebration() {
        // Создаем частицы для праздника
        const particleCount = 50;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(Math.random(), Math.random(), Math.random())
            });
            const particle = new THREE.Mesh(geometry, material);
            
            particle.position.set(
                Math.random() * 20 - 10,
                Math.random() * 10,
                Math.random() * 20 - 10
            );
            
            particle.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.2,
                Math.random() * 0.2 + 0.1,
                (Math.random() - 0.5) * 0.2
            );
            
            this.scene.add(particle);
            particles.push(particle);
        }
        
        // Анимация частиц
        const animateParticles = () => {
            particles.forEach((particle, index) => {
                particle.position.add(particle.velocity);
                particle.velocity.y -= 0.01; // гравитация
                
                // Удаляем упавшие частицы
                if (particle.position.y < 0) {
                    this.scene.remove(particle);
                    particles.splice(index, 1);
                }
            });
            
            if (particles.length > 0) {
                requestAnimationFrame(animateParticles);
            }
        };
        
        animateParticles();
    }
    
    // === ОСНОВНОЙ ЦИКЛ ===
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Обновляем TWEEN анимации
        TWEEN.update();
        
        // Обновляем управление камерой
        if (this.controls) {
            this.controls.update();
        }
        
        // Рендерим сцену
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    onResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    showFallback() {
        this.container.innerHTML = `
            <div style="
                width: 100%; 
                height: 100%; 
                display: flex; 
                align-items: center; 
                justify-content: center;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 10px;
                text-align: center;
                padding: 20px;
            ">
                <div>
                    <div style="font-size: 48px; margin-bottom: 20px;">🚜</div>
                    <h3>3D Ферма не загрузилась</h3>
                    <p style="margin-bottom: 20px;">Попробуйте обновить страницу или проверьте подключение к интернету</p>
                    <button onclick="location.reload()" style="
                        padding: 10px 20px;
                        background: white;
                        color: #764ba2;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-weight: bold;
                    ">
                        Обновить
                    </button>
                </div>
            </div>
        `;
    }
}

// Глобальная экспорт для использования в HTML
if (typeof window !== 'undefined') {
    window.Farm3DEngine = Farm3DEngine;
}
