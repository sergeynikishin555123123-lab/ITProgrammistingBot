class Farm3DScene {
    constructor(containerId, userId) {
        this.containerId = containerId;
        this.userId = userId;
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        this.farmObjects = new Map();
        this.animations = [];
    }
    
    async init() {
        // Инициализация Three.js сцены
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        // Создаем сцену
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB); // Небесно-голубой
        
        // Создаем камеру
        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(15, 10, 15);
        this.camera.lookAt(0, 0, 0);
        
        // Создаем рендерер
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        // Добавляем управление камерой
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        
        // Добавляем освещение
        this.setupLighting();
        
        // Добавляем землю
        this.createGround();
        
        // Добавляем небо
        this.createSky();
        
        // Загружаем модели фермы
        await this.loadFarmModels();
        
        // Загружаем состояние фермы пользователя
        await this.loadUserFarm();
        
        // Запускаем анимацию
        this.animate();
        
        // Обработка изменения размера окна
        window.addEventListener('resize', () => this.onWindowResize());
    }
    
    setupLighting() {
        // Основной направленный свет (солнце)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        // Вспомогательный свет
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        
        // Точечный свет для эффектов
        const pointLight = new THREE.PointLight(0xffaa00, 0.5, 100);
        pointLight.position.set(10, 5, 10);
        this.scene.add(pointLight);
    }
    
    createGround() {
        // Создаем текстуру травы
        const grassTexture = new THREE.TextureLoader().load('/assets/textures/grass.jpg');
        grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
        grassTexture.repeat.set(20, 20);
        
        // Создаем землю
        const groundGeometry = new THREE.PlaneGeometry(100, 100);
        const groundMaterial = new THREE.MeshLambertMaterial({ map: grassTexture });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Добавляем сетку для навигации
        const gridHelper = new THREE.GridHelper(100, 100, 0x000000, 0x000000);
        gridHelper.material.opacity = 0.1;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
    }
    
    createSky() {
        // Создаем небо
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87CEEB,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
        
        // Добавляем облака
        this.createClouds();
    }
    
    createClouds() {
        // Создаем несколько облаков
        for (let i = 0; i < 5; i++) {
            const cloud = this.createCloud();
            cloud.position.set(
                Math.random() * 80 - 40,
                20 + Math.random() * 10,
                Math.random() * 80 - 40
            );
            this.scene.add(cloud);
        }
    }
    
    createCloud() {
        // Создаем облако из нескольких сфер
        const cloud = new THREE.Group();
        
        const cloudMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        
        // Центральная часть
        const centerSphere = new THREE.Mesh(
            new THREE.SphereGeometry(3, 8, 8),
            cloudMaterial
        );
        cloud.add(centerSphere);
        
        // Боковые части
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const x = Math.cos(angle) * 2.5;
            const z = Math.sin(angle) * 2.5;
            
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(2, 8, 8),
                cloudMaterial
            );
            sphere.position.set(x, 0, z);
            cloud.add(sphere);
        }
        
        return cloud;
    }
    
    async loadFarmModels() {
        // Загружаем базовые модели для фермы
        this.models = {
            house: await this.loadModel('/assets/models/house.glb'),
            barn: await this.loadModel('/assets/models/barn.glb'),
            tractor: await this.loadModel('/assets/models/tractor.glb'),
            cropWheat: await this.loadModel('/assets/models/wheat.glb'),
            cropCorn: await this.loadModel('/assets/models/corn.glb'),
            animalCow: await this.loadModel('/assets/models/cow.glb'),
            animalChicken: await this.loadModel('/assets/models/chicken.glb')
        };
        
        console.log('✅ Модели фермы загружены');
    }
    
    async loadModel(url) {
        // Загрузка GLTF модели
        return new Promise((resolve) => {
            const loader = new THREE.GLTFLoader();
            loader.load(url, (gltf) => {
                resolve(gltf.scene);
            }, undefined, (error) => {
                console.error('Ошибка загрузки модели:', error);
                // Создаем простую геометрию как fallback
                resolve(this.createFallbackModel());
            });
        });
    }
    
    createFallbackModel() {
        // Простая геометрия если модель не загрузилась
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
        return new THREE.Mesh(geometry, material);
    }
    
    async loadUserFarm() {
        try {
            const response = await fetch(`/api/farm/${this.userId}`);
            const farmData = await response.json();
            
            // Визуализируем данные фермы
            this.renderFarm(farmData);
            
        } catch (error) {
            console.error('Ошибка загрузки фермы:', error);
        }
    }
    
    renderFarm(farmData) {
        // Очищаем предыдущие объекты
        this.clearFarm();
        
        // Рендерим постройки
        if (farmData.buildings && Array.isArray(farmData.buildings)) {
            farmData.buildings.forEach((building, index) => {
                this.addBuilding(building, index);
            });
        }
        
        // Рендерим посадки
        if (farmData.crops && Array.isArray(farmData.crops)) {
            farmData.crops.forEach((crop, index) => {
                this.addCrop(crop, index);
            });
        }
        
        // Рендерим животных
        if (farmData.animals && Array.isArray(farmData.animals)) {
            farmData.animals.forEach((animal, index) => {
                this.addAnimal(animal, index);
            });
        }
        
        // Рендерим декорации
        if (farmData.decorations && Array.isArray(farmData.decorations)) {
            farmData.decorations.forEach((decoration, index) => {
                this.addDecoration(decoration, index);
            });
        }
    }
    
    addBuilding(building, index) {
        const { type, level, position } = building;
        const model = this.models[type] || this.models.house;
        
        const buildingClone = model.clone();
        buildingClone.position.set(
            (position?.x || index * 10) - 20,
            0,
            (position?.z || 0) - 20
        );
        
        // Масштабируем в зависимости от уровня
        const scale = 1 + (level - 1) * 0.2;
        buildingClone.scale.set(scale, scale, scale);
        
        buildingClone.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        this.scene.add(buildingClone);
        this.farmObjects.set(`building-${index}`, buildingClone);
    }
    
    addCrop(crop, index) {
        const { type, growth, position } = crop;
        const modelKey = `crop${type.charAt(0).toUpperCase() + type.slice(1)}`;
        const model = this.models[modelKey] || this.models.cropWheat;
        
        const cropClone = model.clone();
        cropClone.position.set(
            (position?.x || (index % 5) * 5) - 10,
            0,
            (position?.z || Math.floor(index / 5) * 5) - 10
        );
        
        // Масштабируем в зависимости от роста
        const growthScale = growth / 100;
        cropClone.scale.set(growthScale, growthScale, growthScale);
        
        this.scene.add(cropClone);
        this.farmObjects.set(`crop-${index}`, cropClone);
        
        // Анимация роста
        this.animateCropGrowth(cropClone, growth);
    }
    
    animateCropGrowth(crop, targetGrowth) {
        const targetScale = targetGrowth / 100;
        const currentScale = crop.scale.y;
        
        if (Math.abs(currentScale - targetScale) > 0.01) {
            const growthAnimation = {
                object: crop,
                startScale: currentScale,
                targetScale: targetScale,
                duration: 1000,
                startTime: Date.now()
            };
            
            this.animations.push(growthAnimation);
        }
    }
    
    addAnimal(animal, index) {
        const { type, position } = animal;
        const modelKey = `animal${type.charAt(0).toUpperCase() + type.slice(1)}`;
        const model = this.models[modelKey] || this.models.animalCow;
        
        const animalClone = model.clone();
        animalClone.position.set(
            (position?.x || Math.random() * 30 - 15),
            0,
            (position?.z || Math.random() * 30 - 15)
        );
        
        // Анимация движения животного
        this.animateAnimal(animalClone);
        
        this.scene.add(animalClone);
        this.farmObjects.set(`animal-${index}`, animalClone);
    }
    
    animateAnimal(animal) {
        // Простая анимация движения по кругу
        const radius = 5 + Math.random() * 10;
        const speed = 0.5 + Math.random() * 1;
        
        const animate = () => {
            const time = Date.now() * 0.001;
            animal.position.x = Math.cos(time * speed) * radius;
            animal.position.z = Math.sin(time * speed) * radius;
            
            // Поворачиваем животное в направлении движения
            animal.lookAt(
                Math.cos(time * speed + 0.1) * radius,
                0,
                Math.sin(time * speed + 0.1) * radius
            );
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    addDecoration(decoration, index) {
        // Добавляем декорации (деревья, камни, etc)
        const geometry = new THREE.ConeGeometry(1, 3, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
        const tree = new THREE.Mesh(geometry, material);
        
        tree.position.set(
            (index % 3) * 15 - 20,
            1.5,
            Math.floor(index / 3) * 15 - 20
        );
        tree.castShadow = true;
        
        this.scene.add(tree);
        this.farmObjects.set(`decoration-${index}`, tree);
    }
    
    clearFarm() {
        // Удаляем все объекты фермы
        this.farmObjects.forEach((obj) => {
            this.scene.remove(obj);
        });
        this.farmObjects.clear();
        this.animations = [];
    }
    
    updateFarm(farmData) {
        // Обновляем ферму новыми данными
        this.renderFarm(farmData);
    }
    
    playAnimation(animationName) {
        switch (animationName) {
            case 'lesson-completed':
                this.playCelebrationAnimation();
                break;
            case 'new-building':
                this.playBuildingAnimation();
                break;
            case 'harvest':
                this.playHarvestAnimation();
                break;
        }
    }
    
    playCelebrationAnimation() {
        // Анимация праздника при завершении урока
        const particles = [];
        const particleCount = 100;
        
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: Math.random() * 0xffffff
            });
            const particle = new THREE.Mesh(geometry, material);
            
            particle.position.set(
                Math.random() * 20 - 10,
                Math.random() * 20,
                Math.random() * 20 - 10
            );
            
            particle.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.1,
                Math.random() * 0.1 + 0.05,
                (Math.random() - 0.5) * 0.1
            );
            
            this.scene.add(particle);
            particles.push(particle);
        }
        
        // Анимация частиц
        const animateParticles = () => {
            particles.forEach((particle, index) => {
                particle.position.add(particle.velocity);
                particle.velocity.y -= 0.01; // гравитация
                
                // Удаляем частицы когда они упали
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
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Обновляем анимации
        this.updateAnimations();
        
        // Обновляем управление камерой
        if (this.controls) {
            this.controls.update();
        }
        
        // Рендерим сцену
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    updateAnimations() {
        const currentTime = Date.now();
        
        for (let i = this.animations.length - 1; i >= 0; i--) {
            const animation = this.animations[i];
            const elapsed = currentTime - animation.startTime;
            const progress = Math.min(elapsed / animation.duration, 1);
            
            // Интерполяция масштаба
            const scale = animation.startScale + 
                (animation.targetScale - animation.startScale) * progress;
            
            animation.object.scale.set(scale, scale, scale);
            
            // Удаляем завершенные анимации
            if (progress >= 1) {
                this.animations.splice(i, 1);
            }
        }
    }
    
    onWindowResize() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
}
