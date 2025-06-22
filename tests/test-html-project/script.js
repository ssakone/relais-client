// Test JavaScript functionality for Relais Deploy
console.log('🚀 Relais Deploy Test Project Loaded!');

function testFunction() {
    const output = document.getElementById('output');
    const currentTime = new Date().toLocaleString();
    
    output.innerHTML = `
        <h3>✅ JavaScript Working!</h3>
        <p>Button clicked at: ${currentTime}</p>
        <p>Deploy feature is working correctly! 🎉</p>
    `;
    
    // Add some animation
    output.style.animation = 'fadeIn 0.5s ease-in';
    
    console.log('Test button clicked at:', currentTime);
}

// Add fade-in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);

// Add welcome message when page loads
window.addEventListener('load', () => {
    console.log('Welcome to Relais Deploy test project!');
    
    // Add a subtle pulse animation to the title
    const title = document.querySelector('h1');
    title.style.animation = 'pulse 2s infinite';
    
    const pulseStyle = document.createElement('style');
    pulseStyle.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(pulseStyle);
}); 