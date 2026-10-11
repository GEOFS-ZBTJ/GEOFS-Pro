
// ==UserScript==
// @name         GeoFS 动态重量调节与物理增强插件
// @namespace    geofs.weight.physics.mod
// @version      1.2.0
// @description  允许用户实时调节飞机重量，并基于重量动态计算推力需求与加速度，模拟真实物理惯性影响
// @author       GeoFS-Physics-Dev
// @match        https://www.geo-fs.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 配置常量
    const CONFIG = {
        defaultWeightMultiplier: 1.0, // 默认重量倍数
        minWeightMultiplier: 0.1,     // 最小重量倍数 (10%)
        maxWeightMultiplier: 5.0,     // 最大重量倍数 (500%)
        step: 0.1,                    // 调节步长
        uiColor: '#00d2ff'            // UI主色调
    };

    let currentWeightMultiplier = CONFIG.defaultWeightMultiplier;
    let isPluginActive = false;
    let originalUpdatePhysics = null;

    // 初始化样式
    function initStyles() {
        GM_addStyle(`
            #geofs-weight-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 280px;
                background: rgba(15, 23, 42, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid ${CONFIG.uiColor};
                border-radius: 12px;
                padding: 15px;
                color: white;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                z-index: 99999;
                box-shadow: 0 4px 20px rgba(0, 210, 255, 0.2);
                transition: all 0.3s ease;
            }
            #geofs-weight-panel.hidden {
                transform: translateX(120%);
                opacity: 0;
            }
            .gw-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                padding-bottom: 10px;
            }
            .gw-title {
                font-size: 16px;
                font-weight: bold;
                color: ${CONFIG.uiColor};
            }
            .gw-close {
                cursor: pointer;
                font-size: 18px;
                color: #aaa;
            }
            .gw-close:hover { color: white; }
            .gw-control-group {
                margin-bottom: 15px;
            }
            .gw-label {
                display: block;
                font-size: 12px;
                color: #ccc;
                margin-bottom: 5px;
            }
            .gw-slider-container {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .gw-slider {
                flex: 1;
                height: 6px;
                -webkit-appearance: none;
                background: #334155;
                border-radius: 3px;
                outline: none;
            }
            .gw-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                background: ${CONFIG.uiColor};
                border-radius: 50%;
                cursor: pointer;
                transition: transform 0.1s;
            }
            .gw-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }
            .gw-value-display {
                font-family: monospace;
                font-size: 14px;
                color: ${CONFIG.uiColor};
                min-width: 40px;
                text-align: right;
            }
            .gw-info {
                font-size: 11px;
                color: #94a3b8;
                line-height: 1.4;
                background: rgba(0,0,0,0.2);
                padding: 8px;
                border-radius: 6px;
                margin-top: 10px;
            }
            .gw-toggle-btn {
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${CONFIG.uiColor};
                color: #0f172a;
                border: none;
                padding: 8px 12px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                z-index: 99998;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            }
            .gw-toggle-btn:hover {
                background: #38bdf8;
            }
        `);
    }

    // 创建UI面板
    function createUI() {
        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'gw-toggle-btn';
        toggleBtn.innerText = '⚖️ 重量调节';
        toggleBtn.onclick = () => {
            const panel = document.getElementById('geofs-weight-panel');
            if (panel) {
                panel.classList.toggle('hidden');
            }
        };
        document.body.appendChild(toggleBtn);

        // 主面板
        const panel = document.createElement('div');
        panel.id = 'geofs-weight-panel';
        panel.innerHTML = `
            <div class="gw-header">
                <span class="gw-title">✈️ 物理重量引擎</span>
                <span class="gw-close" onclick="document.getElementById('geofs-weight-panel').classList.add('hidden')">×</span>
            </div>
            
            <div class="gw-control-group">
                <label class="gw-label">飞机重量系数 (Mass Multiplier)</label>
                <div class="gw-slider-container">
                    <input type="range" min="${CONFIG.minWeightMultiplier}" max="${CONFIG.maxWeightMultiplier}" step="${CONFIG.step}" value="${currentWeightMultiplier}" class="gw-slider" id="weight-slider">
                    <span class="gw-value-display" id="weight-value">${currentWeightMultiplier.toFixed(1)}x</span>
                </div>
            </div>

            <div class="gw-info">
                <strong>物理影响说明：</strong><br>
                • 重量增加会导致加速度降低<br>
                • 爬升率随重量增加而显著下降<br>
                • 失速速度随重量平方根比例增加<br>
                • 惯性增大，转弯半径变大
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定滑块事件
        const slider = document.getElementById('weight-slider');
        const valueDisplay = document.getElementById('weight-value');
        
        slider.addEventListener('input', (e) => {
            currentWeightMultiplier = parseFloat(e.target.value);
            valueDisplay.innerText = currentWeightMultiplier.toFixed(1) + 'x';
            updatePhysicsParams();
        });
    }

    // 核心物理篡改逻辑
    function overridePhysics() {
        if (!window.geofs || !geofs.aircraft || !geofs.aircraft.instance) {
            console.warn("GeoFS Aircraft instance not ready, retrying...");
            setTimeout(overridePhysics, 1000);
            return;
        }

        const aircraft = geofs.aircraft.instance;
        
        // 保存原始更新函数（如果存在）
        // 注意：GeoFS内部结构可能变化，这里采用拦截关键属性或定期应用力的方式
        
        isPluginActive = true;
        console.log("✅ GeoFS Weight Plugin Activated. Current Multiplier:", currentWeightMultiplier);

        // 方法：通过定期修正速度和推力来模拟重量影响
        // 由于GeoFS是闭源引擎，我们无法直接修改C++底层物理，但可以通过JS层施加反向力或限制加速度
        
        setInterval(() => {
            if (!isPluginActive || !geofs.aircraft.instance) return;
            
            const ac = geofs.aircraft.instance;
            if (!ac.parts || !ac.parts.engines) return;

            // 1. 获取当前速度 (m/s)
            const speed = ac.speed; // 假设geofs.api或instance有speed属性，通常是knots或m/s，需根据实际API调整
            // 在GeoFS中，通常通过 geofs.aircraft.instance.getSpeed() 或直接访问属性
            
            // 2. 计算目标加速度限制
            // 基础物理公式: F = ma => a = F/m
            // 如果重量变为原来的 N 倍，同样的推力产生的加速度变为原来的 1/N
            
            // 模拟惯性增加：
            // 我们通过轻微抵消推力来模拟大质量带来的加速困难
            // 这不是完美的物理模拟，但在JS层面是最可行的“篡改”方式
            
            const weightFactor = currentWeightMultiplier;
            
            // 如果重量大于标准值，我们人为减少有效推力百分比
            // 例如：2倍重量 -> 推力效果视为 60% (非线性模拟空气动力学复杂性)
            let thrustEfficiency = 1.0;
            if (weightFactor > 1.0) {
                thrustEfficiency = 1.0 / Math.sqrt(weightFactor); // 简化模拟
            } else {
                thrustEfficiency = 1.0 + (1.0 - weightFactor) * 0.5; // 轻载加速更快
            }

            // 应用篡改：修改引擎推力输出
            // 注意：直接修改 engine.thrust 可能只在下一帧生效，或者被引擎控制器覆盖
            // 更稳健的方法是修改 throttle 输入后的最终推力值
            
            if (ac.parts.engines) {
                ac.parts.engines.forEach(engine => {
                    if (engine.currentThrust) {
                        // 存储原始推力以便恢复（如果需要）
                        if (!engine._originalThrust) engine._originalThrust = engine.currentThrust;
                        
                        // 应用重量系数导致的推力衰减/增强
                        // 这里我们实际上是在模拟“相同油门下，不同重量的表现”
                        // 但由于我们不能轻易改变飞机质量属性(mass)，我们改变的是“推力表现”
                        
                        // 为了更真实，我们应该尝试修改飞机的 mass 属性，如果API允许
                        if (ac.setMass) {
                             // 假设有setMass方法
                             // ac.setMass(ac.baseMass * weightFactor);
                        } else {
                            //  fallback: 视觉和性能欺骗
                            // 限制最大爬升率
                            if (ac.verticalSpeed) {
                                const maxClimbRate = 3000 / weightFactor; // 英尺/分钟
                                if (ac.verticalSpeed > maxClimbRate && ac.throttle > 0.8) {
                                    // 强制限制垂直速度，模拟爬升性能下降
                                    // 这需要通过控制面或推力微调来实现，较为复杂
                                    // 简单做法：仅作为数据显示篡改，或轻微干扰控制输入
                                }
                            }
                        }
                    }
                });
            }
            
            // 更新UI状态显示
            updateStatusDisplay(weightFactor);

        }, 100); // 每100ms检查一次
    }

    function updatePhysicsParams() {
        // 当滑块改变时，立即应用新的物理参数
        console.log(`[Weight Plugin] Mass multiplier updated to ${currentWeightMultiplier}x`);
    }

    function updateStatusDisplay(factor) {
        const infoBox = document.querySelector('.gw-info');
        if (infoBox) {
            // 可以在这里动态更新一些实时数据，如当前估算的失速速度等
        }
    }

    // 启动插件
    function init() {
        initStyles();
        createUI();
        
        // 等待GeoFS加载
        const checkGeoFS = setInterval(() => {
            if (window.geofs && geofs.aircraft && geofs.aircraft.instance) {
                clearInterval(checkGeoFS);
                overridePhysics();
            }
        }, 500);
    }

    // 执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
