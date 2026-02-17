// Test script to manipulate settings panel and sliders

// 1. Open settings panel
document.getElementById('settings-panel').classList.add('open');
console.log('✓ Settings panel opened');

// Wait 1 second, then test width slider
setTimeout(() => {
    // 2. Set Width (横幅) to 50
    let widthSlider = document.getElementById('p-scaleX');
    if (widthSlider) {
        widthSlider.value = 50;
        widthSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Width set to 50');
    }
}, 1000);

// Wait 3 seconds, then test linearize
setTimeout(() => {
    // 3. Reset width back to 100
    let widthSlider = document.getElementById('p-scaleX');
    if (widthSlider) {
        widthSlider.value = 100;
        widthSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Width reset to 100');
    }
    
    // 4. Set Linearize (直線化) to 5
    let linearizeSlider = document.getElementById('p-linearize');
    if (linearizeSlider) {
        linearizeSlider.value = 5;
        linearizeSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Linearize set to 5');
    }
}, 3000);

// Wait 5 seconds, then test roughen
setTimeout(() => {
    // 5. Reset linearize back to 0
    let linearizeSlider = document.getElementById('p-linearize');
    if (linearizeSlider) {
        linearizeSlider.value = 0;
        linearizeSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Linearize reset to 0');
    }
    
    // 6. Set Roughen (ラフ) to 10
    let roughenSlider = document.getElementById('p-roughen');
    if (roughenSlider) {
        roughenSlider.value = 10;
        roughenSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Roughen set to 10');
    }
}, 5000);

// Wait 7 seconds, then test twist
setTimeout(() => {
    // 7. Set Twist (ランダム・ひねり) to 15
    let twistSlider = document.getElementById('p-twist');
    if (twistSlider) {
        twistSlider.value = 15;
        twistSlider.dispatchEvent(new Event('input', {bubbles: true}));
        console.log('✓ Twist set to 15');
    }
}, 7000);

console.log('Test script started - will run automated tests...');
