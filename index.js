lucide.createIcons();

let forecastChart = null;
let monthlyChart = null;
let searchTimeout = null;
let currentLocationData = null;
let conversationContext = [];

// Starfield Animation
const canvas = document.getElementById('starCanvas');
const ctx = canvas.getContext('2d');
let stars = [];

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

class Star {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2.5;
        this.speed = Math.random() * 0.8 + 0.2;
        this.opacity = Math.random();
    }
    draw() {
        ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
    update() {
        this.y += this.speed;
        if (this.y > canvas.height) {
            this.y = 0;
            this.x = Math.random() * canvas.width;
        }
        this.opacity = Math.sin(Date.now() / 1000 + this.x) * 0.5 + 0.5;
    }
}

function initStars() {
    stars = [];
    for (let i = 0; i < 300; i++) stars.push(new Star());
}

function animateStars() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => { s.update(); s.draw(); });
    requestAnimationFrame(animateStars);
}

window.addEventListener('resize', resize);
resize();
initStars();
animateStars();

// ============ WEATHER ALERTS & NOTIFICATIONS ============
const ALERT_RULES = {
    rainProbThreshold: 60,
    rainMmThreshold: 5,
    heatMaxThreshold: 38,
    coldMinThreshold: 10,
    stormCodeMin: 95
};

function alertsEnabled() {
    return localStorage.getItem('jarvis_alerts_enabled') === '1';
}

function setAlertsEnabled(v) {
    localStorage.setItem('jarvis_alerts_enabled', v ? '1' : '0');
}

function notificationsSupported() {
    return 'Notification' in window;
}

function toast(title, body, actions = [], ttlMs = 6500) {
    const host = document.getElementById('toast-container');
    if (!host) return;

    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-body">${body}</div>
    ${actions.length ? `<div class="toast-actions"></div>` : ``}
  `;

    if (actions.length) {
        const actionsEl = el.querySelector('.toast-actions');
        actions.forEach(a => {
            const b = document.createElement('button');
            b.className = `toast-btn ${a.primary ? 'primary' : ''}`;
            b.textContent = a.label;
            b.onclick = () => {
                try { a.onClick && a.onClick(); } finally { el.remove(); }
            };
            actionsEl.appendChild(b);
        });
    }

    host.appendChild(el);

    if (ttlMs && !actions.length) {
        setTimeout(() => el.remove(), ttlMs);
    }
}

async function enableWeatherAlerts() {
    if (!notificationsSupported()) {
        setAlertsEnabled(true);
        toast('Alerts enabled', 'Browser notifications are not supported here, so alerts will show as in-app toasts.');
        return false;
    }

    if (Notification.permission === 'granted') {
        setAlertsEnabled(true);
        toast('Alerts enabled', 'Weather alerts are now active.');
        return true;
    }

    if (Notification.permission === 'denied') {
        setAlertsEnabled(false);
        toast('Permission blocked', 'Notifications are blocked in browser settings. Enable them for this site to receive alerts.');
        return false;
    }

    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
        setAlertsEnabled(true);
        toast('Alerts enabled', 'Weather alerts are now active.');
        return true;
    }

    setAlertsEnabled(false);
    toast('Not enabled', 'Notification permission was not granted.');
    return false;
}

function disableWeatherAlerts() {
    setAlertsEnabled(false);
    toast('Alerts disabled', 'Weather alerts have been turned off.');
}

function maybePromptEnableAlertsOnce() {
    const prompted = localStorage.getItem('jarvis_alerts_prompted') === '1';
    if (prompted) return;

    localStorage.setItem('jarvis_alerts_prompted', '1');

    toast(
        'Enable weather alerts?',
        'Get rain alerts, extreme temperature warnings, and storm notifications for the selected city.',
        [
            { label: 'Enable', primary: true, onClick: enableWeatherAlerts },
            { label: 'Not now', onClick: () => { } }
        ],
        0
    );
}

function shouldSendAlertOncePerDay(alertType, cityKey, dayISO) {
    const key = `jarvis_alert_sent:${alertType}:${cityKey}:${dayISO}`;
    if (localStorage.getItem(key) === '1') return false;
    localStorage.setItem(key, '1');
    return true;
}

function sendBrowserNotification(title, body, tag) {
    try {
        const n = new Notification(title, {
            body,
            tag,
            renotify: false,
            silent: false
        });
        n.onclick = () => window.focus();
    } catch (e) {
        toast(title, body);
    }
}

function notifyAlert(title, body, tag) {
    if (alertsEnabled() && notificationsSupported() && Notification.permission === 'granted') {
        sendBrowserNotification(title, body, tag);
    } else {
        toast(title, body);
    }
}

function checkAndNotifyAlerts(weatherData, cityName, country) {
    if (!weatherData || !weatherData.daily) return;

    const cityKey = `${cityName || ''}|${country || ''}`.toLowerCase();
    const dayISO = (weatherData.daily.time && weatherData.daily.time[0]) ? weatherData.daily.time[0] : new Date().toISOString().slice(0, 10);

    const pProb = weatherData.daily.precipitation_probability_max?.[0];
    const pSum = weatherData.daily.precipitation_sum?.[0];
    const tMax = weatherData.daily.temperature_2m_max?.[0];
    const tMin = weatherData.daily.temperature_2m_min?.[0];
    const wCodeToday = weatherData.daily.weather_code?.[0];

    const rainHit = (typeof pProb === 'number' && pProb >= ALERT_RULES.rainProbThreshold) ||
        (typeof pSum === 'number' && pSum >= ALERT_RULES.rainMmThreshold);
    if (rainHit && shouldSendAlertOncePerDay('rain', cityKey, dayISO)) {
        const body = `Chance: ${pProb ?? 'NA'}% | Expected: ${pSum ?? 'NA'} mm. Carry an umbrella / raincoat.`;
        notifyAlert(`Rain alert: ${cityName}`, body, `rain-${cityKey}-${dayISO}`);
    }

    if (typeof tMax === 'number' && tMax >= ALERT_RULES.heatMaxThreshold && shouldSendAlertOncePerDay('heat', cityKey, dayISO)) {
        notifyAlert(`Heat warning: ${cityName}`, `Day max around ${Math.round(tMax)}°C. Stay hydrated and avoid peak sun.`, `heat-${cityKey}-${dayISO}`);
    }

    if (typeof tMin === 'number' && tMin <= ALERT_RULES.coldMinThreshold && shouldSendAlertOncePerDay('cold', cityKey, dayISO)) {
        notifyAlert(`Cold warning: ${cityName}`, `Night min around ${Math.round(tMin)}°C. Dress in layers.`, `cold-${cityKey}-${dayISO}`);
    }

    if (typeof wCodeToday === 'number' && wCodeToday >= ALERT_RULES.stormCodeMin && shouldSendAlertOncePerDay('storm', cityKey, dayISO)) {
        notifyAlert(`Storm alert: ${cityName}`, `Thunderstorm conditions possible today. Prefer staying indoors if needed.`, `storm-${cityKey}-${dayISO}`);
    }
}

// ============ ADVANCED AI CLOTHING LOGIC ============
function getClothingSuggestion(temp, weatherCode, precipitation, humidity, windSpeed) {
    let outfit = {
        top: [],
        bottom: [],
        outer: [],
        accessories: [],
        footwear: [],
        extras: []
    };

    const windChill = windSpeed > 15 ? temp - 2 : temp;

    if (windChill < 5) {
        outfit.top = ['Thermal base layer', 'Warm fleece', 'Heavy sweater'];
        outfit.bottom = ['Thermal leggings', 'Insulated pants', 'Warm jeans'];
        outfit.outer = ['Heavy winter coat', 'Down jacket', 'Parka'];
        outfit.accessories = ['Thick scarf', 'Insulated gloves', 'Wool beanie', 'Ear muffs'];
        outfit.footwear = ['Insulated boots', 'Winter boots'];
        outfit.extras = ['Hand warmers', 'Lip balm'];
    } else if (windChill >= 5 && windChill < 12) {
        outfit.top = ['Long sleeve thermal', 'Sweater', 'Turtleneck'];
        outfit.bottom = ['Jeans', 'Warm trousers', 'Corduroy pants'];
        outfit.outer = ['Winter jacket', 'Wool coat', 'Puffer jacket'];
        outfit.accessories = ['Scarf', 'Gloves', 'Beanie'];
        outfit.footwear = ['Boots', 'Closed-toe shoes'];
        outfit.extras = ['Moisturizer for dry skin'];
    } else if (windChill >= 12 && windChill < 18) {
        outfit.top = ['Long sleeve shirt', 'Light sweater', 'Flannel shirt'];
        outfit.bottom = ['Jeans', 'Chinos', 'Casual pants'];
        outfit.outer = ['Light jacket', 'Denim jacket', 'Cardigan'];
        outfit.accessories = ['Light scarf', 'Sunglasses'];
        outfit.footwear = ['Sneakers', 'Loafers', 'Ankle boots'];
    } else if (windChill >= 18 && windChill < 24) {
        outfit.top = ['T-shirt', 'Polo shirt', 'Cotton shirt'];
        outfit.bottom = ['Jeans', 'Chinos', 'Casual pants'];
        outfit.outer = ['Light hoodie (optional)', 'Denim jacket (optional)'];
        outfit.accessories = ['Sunglasses', 'Cap'];
        outfit.footwear = ['Sneakers', 'Casual shoes', 'Loafers'];
    } else if (windChill >= 24 && windChill < 30) {
        outfit.top = ['Light T-shirt', 'Tank top', 'Breathable shirt'];
        outfit.bottom = ['Shorts', 'Light pants', 'Linen pants'];
        outfit.outer = [];
        outfit.accessories = ['Sunglasses', 'Cap', 'Sunscreen SPF 30+'];
        outfit.footwear = ['Sneakers', 'Sandals', 'Canvas shoes'];
        outfit.extras = ['Water bottle', 'Sweat towel'];
    } else {
        outfit.top = ['Moisture-wicking T-shirt', 'Breathable cotton tee', 'Sleeveless shirt'];
        outfit.bottom = ['Lightweight shorts', 'Linen pants'];
        outfit.outer = [];
        outfit.accessories = ['Wide-brim hat', 'Sunglasses', 'Sunscreen SPF 50+'];
        outfit.footwear = ['Breathable sandals', 'Light sneakers'];
        outfit.extras = ['Water bottle (essential)', 'Cooling towel', 'Electrolyte drink'];
    }

    if (weatherCode >= 51 && weatherCode <= 67) {
        outfit.outer.unshift('Waterproof rain jacket', 'Raincoat');
        outfit.accessories.unshift('Umbrella', 'Waterproof bag');
        outfit.footwear = ['Waterproof boots', 'Rain boots', 'Water-resistant shoes'];
        outfit.extras.push('Waterproof phone case');
    }

    if (weatherCode >= 71 && weatherCode <= 77) {
        outfit.outer.unshift('Insulated waterproof jacket');
        outfit.accessories.unshift('Waterproof gloves', 'Snow boots');
        outfit.footwear = ['Insulated snow boots', 'Waterproof winter boots'];
    }

    if (weatherCode >= 95) {
        outfit.extras.push('Avoid outdoor activities if possible', 'Stay indoors during storm');
    }

    if (humidity > 75) {
        outfit.top = outfit.top.map(item => 'Moisture-wicking ' + item);
        outfit.extras.push('Anti-chafing cream', 'Extra change of clothes');
    }

    if (windSpeed > 20) {
        outfit.outer.push('Windbreaker');
        outfit.accessories.push('Secure hat with strap');
        outfit.extras.push('Wind protection advised');
    }

    if (weatherCode === 0 || weatherCode === 1) {
        outfit.extras.push('UV-protective clothing recommended');
    }

    return outfit;
}

function formatOutfitMessage(outfit, temp, weatherDesc, humidity, windSpeed) {
    let conditions = [];
    if (temp > 30) conditions.push('🔥 Hot');
    else if (temp > 24) conditions.push('☀️ Warm');
    else if (temp > 18) conditions.push('🌤️ Mild');
    else if (temp > 12) conditions.push('🌥️ Cool');
    else conditions.push('❄️ Cold');

    if (humidity > 70) conditions.push('💧 Humid');
    if (windSpeed > 15) conditions.push('💨 Windy');

    let message = `Weather Analysis: ${conditions.join(', ')}\nConditions: ${weatherDesc}\n\n`;

    let allItems = [];

    if (outfit.outer.length > 0) {
        allItems.push(...outfit.outer.slice(0, 2));
    }
    allItems.push(...outfit.top.slice(0, 2));
    allItems.push(...outfit.bottom.slice(0, 2));
    allItems.push(...outfit.footwear.slice(0, 1));
    allItems.push(...outfit.accessories.slice(0, 3));
    if (outfit.extras.length > 0) {
        allItems.push(...outfit.extras.slice(0, 2));
    }

    const outfitHTML = `
        <div class="outfit-suggestion">
            <div class="outfit-title">👔 Smart Outfit Recommendation</div>
            <div class="outfit-items">
                ${allItems.map(item => `<div class="outfit-item">${item}</div>`).join('')}
            </div>
        </div>
    `;

    return { message, outfitHTML };
}

// ============ ADVANCED CHATBOT AI ============
function toggleChatbot() {
    const chatbot = document.getElementById('chatbot');
    chatbot.classList.toggle('active');
    setTimeout(() => lucide.createIcons(), 100);
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    conversationContext.push({ role: 'user', text: message });
    addMessage(message, 'user');
    input.value = '';

    showTypingIndicator();

    setTimeout(() => {
        removeTypingIndicator();
        const response = generateAdvancedBotResponse(message);
        conversationContext.push({ role: 'bot', text: response.text });
        addMessage(response.text, 'bot', response.html);
    }, 1200 + Math.random() * 800);
}

function addMessage(text, type, extraHTML = '') {
    const messagesContainer = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const avatar = type === 'bot' ? '🤖' : '👤';

    messageDiv.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">${text}${extraHTML}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot typing-message';
    typingDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTypingIndicator() {
    const typingMessage = document.querySelector('.typing-message');
    if (typingMessage) {
        typingMessage.remove();
    }
}

// ============ SUPER INTELLIGENT AI RESPONSE SYSTEM ============
function generateAdvancedBotResponse(message) {
    const lowerMessage = message.toLowerCase();

    const intents = {
        clothing: /cloth|wear|outfit|dress|apparel|attire|garment|wardrobe/i,
        weather: /weather|forecast|climate|condition|atmospheric/i,
        temperature: /temp|hot|cold|warm|cool|heat|chill/i,
        rain: /rain|precipitation|shower|drizzle|downpour|wet/i,
        humidity: /humid|moisture|damp|muggy/i,
        wind: /wind|breeze|gust|blow/i,
        planning: /plan|trip|travel|visit|go|going|tomorrow|weekend|next/i,
        comparison: /compare|difference|versus|vs|better|worse/i,
        advice: /suggest|recommend|advise|should|what to|help/i,
        greeting: /hello|hi|hey|greetings|good morning|good evening/i,
        thanks: /thank|thanks|appreciate|grateful/i,
        capability: /can you|are you able|what can|help me|features/i
    };

    if (/enable alerts|turn on alerts|alerts on/i.test(message)) {
        enableWeatherAlerts();
        return { text: "Weather alerts request sent. If permission is granted, notifications will be enabled." };
    }
    if (/disable alerts|turn off alerts|alerts off/i.test(message)) {
        disableWeatherAlerts();
        return { text: "Weather alerts are disabled." };
    }
    if (/alerts status/i.test(message)) {
        const status = alertsEnabled() ? "ON" : "OFF";
        return { text: `Alerts status: ${status}.` };
    }

    if (intents.clothing.test(lowerMessage)) {
        if (currentLocationData) {
            const windSpeed = parseFloat(currentLocationData.wind) || 0;
            const outfit = getClothingSuggestion(
                currentLocationData.temp,
                currentLocationData.weatherCode,
                parseFloat(currentLocationData.precipitation),
                currentLocationData.humidity,
                windSpeed
            );
            const formatted = formatOutfitMessage(
                outfit,
                currentLocationData.temp,
                currentLocationData.desc,
                currentLocationData.humidity,
                windSpeed
            );

            let advice = `\n\n💡 Pro Tip: `;
            if (currentLocationData.temp > 30) {
                advice += "Stay hydrated and avoid outdoor activities during peak afternoon hours (12-3 PM).";
            } else if (currentLocationData.temp < 10) {
                advice += "Layer your clothing to trap warm air and adjust easily to indoor/outdoor temperature changes.";
            } else if (currentLocationData.humidity > 70) {
                advice += "Choose breathable fabrics like cotton or moisture-wicking materials to stay comfortable.";
            } else {
                advice += "This is ideal weather! Dress comfortably and enjoy your day.";
            }

            return {
                text: formatted.message + advice,
                html: formatted.outfitHTML
            };
        }
        return { text: "I'd love to help you choose the perfect outfit! Please search for a city first using the search box on the left, and I'll analyze the weather conditions to provide personalized clothing recommendations." };
    }

    if (intents.weather.test(lowerMessage)) {
        if (currentLocationData) {
            let response = `🌍 **${currentLocationData.name} Weather Report**\n\n`;
            response += `Current: ${currentLocationData.temp}°C (Feels like ${currentLocationData.feelsLike}°C)\n`;
            response += `Conditions: ${currentLocationData.desc}\n`;
            response += `Humidity: ${currentLocationData.humidity}%\n`;
            response += `Wind: ${currentLocationData.wind} km/h\n`;
            response += `Precipitation: ${currentLocationData.precipitation} mm\n\n`;

            if (currentLocationData.temp > 28) {
                response += `⚠️ It's quite hot! Stay hydrated and use sun protection.`;
            } else if (currentLocationData.temp < 12) {
                response += `🧥 Bundle up! It's cold outside.`;
            } else {
                response += `✨ Pleasant weather conditions!`;
            }

            response += `\n\nCheck the dashboard for detailed 7-day forecasts and 6-month climate predictions!`;
            return { text: response };
        }
        return { text: "I can provide comprehensive weather analysis for any location worldwide! Search for a city using the search box, and I'll give you detailed weather insights including temperature, humidity, wind conditions, and precipitation forecasts." };
    }

    if (intents.temperature.test(lowerMessage)) {
        if (currentLocationData) {
            let response = `🌡️ Temperature in ${currentLocationData.name}:\n\n`;
            response += `Actual: ${currentLocationData.temp}°C\n`;
            response += `Feels Like: ${currentLocationData.feelsLike}°C\n\n`;

            const diff = currentLocationData.feelsLike - currentLocationData.temp;
            if (Math.abs(diff) > 3) {
                response += `Note: The "feels like" temperature is ${Math.abs(diff).toFixed(1)}°C ${diff > 0 ? 'warmer' : 'cooler'} due to `;
                response += diff > 0 ? 'humidity factors.' : 'wind chill effect.';
            }

            return { text: response };
        }
        return { text: "Search for a city to get accurate temperature data with real-time feels-like analysis!" };
    }

    if (intents.rain.test(lowerMessage)) {
        if (currentLocationData) {
            let response = `🌧️ Precipitation Analysis for ${currentLocationData.name}:\n\n`;
            response += `Current: ${currentLocationData.precipitation} mm\n`;

            if (parseFloat(currentLocationData.precipitation) > 5) {
                response += `\n⚠️ Heavy rainfall detected! Carry an umbrella and wear waterproof footwear.`;
            } else if (parseFloat(currentLocationData.precipitation) > 0.5) {
                response += `\n☔ Light rain expected. An umbrella might be handy.`;
            } else {
                response += `\n☀️ No rain currently. Enjoy dry conditions!`;
            }

            response += `\n\nCheck the 7-day forecast cards for upcoming rain predictions with probability percentages!`;
            return { text: response };
        }
        return { text: "I can provide detailed rain forecasts! Search for a location to see current precipitation, hourly predictions, and 7-day rain probability data." };
    }

    if (intents.humidity.test(lowerMessage)) {
        if (currentLocationData) {
            let response = `💧 Humidity in ${currentLocationData.name}: ${currentLocationData.humidity}%\n\n`;

            if (currentLocationData.humidity > 80) {
                response += `Very humid! You might feel sticky and uncomfortable. Wear breathable fabrics and stay in air-conditioned spaces when possible.`;
            } else if (currentLocationData.humidity > 60) {
                response += `Moderately humid. Light, moisture-wicking clothing recommended.`;
            } else if (currentLocationData.humidity > 40) {
                response += `Comfortable humidity levels. Ideal conditions!`;
            } else {
                response += `Low humidity. Use moisturizer and stay hydrated to avoid dry skin.`;
            }

            return { text: response };
        }
        return { text: "Search for a city to check humidity levels with personalized comfort advice!" };
    }

    if (intents.wind.test(lowerMessage)) {
        if (currentLocationData) {
            const windKmh = parseFloat(currentLocationData.wind);
            let response = `💨 Wind Conditions in ${currentLocationData.name}:\n\n`;
            response += `Speed: ${windKmh} km/h\n\n`;

            if (windKmh > 40) {
                response += `⚠️ Strong winds! Secure loose objects and avoid outdoor activities.`;
            } else if (windKmh > 25) {
                response += `Quite windy. Wear a windbreaker and be cautious with umbrellas.`;
            } else if (windKmh > 15) {
                response += `Breezy conditions. Pleasant for outdoor activities!`;
            } else {
                response += `Calm winds. Perfect weather for any outdoor plans!`;
            }

            return { text: response };
        }
        return { text: "I can analyze wind conditions for any location! Search for a city to get wind speed data with safety recommendations." };
    }

    if (intents.planning.test(lowerMessage)) {
        if (currentLocationData) {
            return { text: `Planning a trip to ${currentLocationData.name}? Great choice!\n\nCurrent weather: ${currentLocationData.temp}°C, ${currentLocationData.desc}.\n\nI recommend checking the 7-day forecast tab to plan your activities. You can also switch to the 6-month climate view for long-term travel planning.\n\nWould you like outfit suggestions for your trip? Just ask "what should I wear?"` };
        }
        return { text: "I can help you plan your trip with weather forecasts! Search for your destination city, and I'll provide detailed forecasts, clothing recommendations, and travel tips based on weather conditions." };
    }

    if (intents.greeting.test(lowerMessage)) {
        const greetings = [
            "Hello! I'm JARVIS, your intelligent weather companion. How may I assist you today?",
            "Greetings! Ready to provide you with advanced weather intelligence and personalized recommendations!",
            "Hi there! JARVIS at your service. Ask me anything about weather, forecasts, or clothing suggestions!"
        ];
        return { text: greetings[Math.floor(Math.random() * greetings.length)] };
    }

    if (intents.thanks.test(lowerMessage)) {
        const responses = [
            "You're very welcome! Always happy to help with weather insights. 😊",
            "My pleasure! Feel free to ask if you need anything else!",
            "Glad I could help! Stay weather-ready! ⚡"
        ];
        return { text: responses[Math.floor(Math.random() * responses.length)] };
    }

    if (intents.capability.test(lowerMessage) || lowerMessage.includes('help')) {
        return {
            text: `I'm JARVIS, your advanced AI weather assistant! Here's what I can do:\n\n🌡️ **Weather Analysis**\n• Real-time conditions\n• 7-day forecasts\n• 6-month climate predictions\n\n👔 **Smart Recommendations**\n• Personalized outfit suggestions\n• Activity planning advice\n• Travel preparation tips\n\n📊 **Detailed Insights**\n• Temperature (actual & feels-like)\n• Humidity & wind analysis\n• Precipitation forecasts\n• Weather pattern interpretation\n\n💡 **Pro Features**\n• Context-aware responses\n• Multi-city comparisons\n• Historical climate data\n\nJust search for any city and start asking questions! Try:\n• "What should I wear?"\n• "Will it rain tomorrow?"\n• "Is it good for outdoor plans?"\n• "Compare weather with [city]"`
        };
    }

    const contextResponses = [
        "I'm here to help with weather insights! Try asking about temperature, rain, clothing suggestions, or search for a specific city.",
        "Not sure I understood that completely. I specialize in weather forecasts, outfit recommendations, and climate analysis. What would you like to know?",
        "Let me help you better! I can provide weather forecasts, smart clothing advice, and travel planning tips. Search for a city or ask a specific weather question.",
        "I'm your weather intelligence assistant! Ask me about current conditions, forecasts, what to wear, or any weather-related questions."
    ];

    return { text: contextResponses[Math.floor(Math.random() * contextResponses.length)] };
}

// ============ TAB SWITCHING ============
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tab === '7day') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('7day-tab').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('6month-tab').classList.add('active');
    }
}

function getWeatherIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 3) return '⛅';
    if (code <= 48) return '🌫️';
    if (code <= 67) return '🌧️';
    if (code <= 77) return '❄️';
    if (code <= 82) return '🌦️';
    if (code <= 99) return '⛈️';
    return '🌤️';
}

function getWeatherDesc(code) {
    if (code === 0) return 'Clear sky';
    if (code <= 3) return 'Partly cloudy';
    if (code <= 48) return 'Foggy';
    if (code <= 67) return 'Rainy';
    if (code <= 77) return 'Snowy';
    if (code <= 82) return 'Showers';
    if (code <= 99) return 'Thunderstorm';
    return 'Clear';
}

async function searchCities(query) {
    if (query.length < 2) return [];

    try {
        const response = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json`
        );
        const data = await response.json();

        if (data.results) {
            return data.results.map(city => ({
                name: city.name,
                country: city.country || '',
                admin: city.admin1 || '',
                lat: city.latitude,
                lon: city.longitude,
                population: city.population || 0
            }));
        }
        return [];
    } catch (error) {
        console.error('City search error:', error);
        return [];
    }
}

function displaySuggestions(cities) {
    const dropdown = document.getElementById('suggestions');

    if (cities.length === 0) {
        dropdown.classList.remove('active');
        return;
    }

    dropdown.innerHTML = cities.map(city => {
        const displayName = city.admin ? `${city.name}, ${city.admin}` : city.name;
        const popText = city.population > 0 ? ` • ${(city.population / 1000).toFixed(0)}k` : '';

        return `
            <div class="suggestion-item" onclick='selectCity(${JSON.stringify(city.name)}, ${city.lat}, ${city.lon}, ${JSON.stringify(city.country)})'>
                <div class="suggestion-city">${displayName}</div>
                <div class="suggestion-country">${city.country}${popText}</div>
            </div>
        `;
    }).join('');

    dropdown.classList.add('active');
}

document.getElementById('location-search').addEventListener('input', async (e) => {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
        document.getElementById('suggestions').classList.remove('active');
        return;
    }

    searchTimeout = setTimeout(async () => {
        const cities = await searchCities(query);
        displaySuggestions(cities);
    }, 300);
});

function selectCity(name, lat, lon, country) {
    document.getElementById('location-search').value = name;
    document.getElementById('suggestions').classList.remove('active');
    loadWeatherData(lat, lon, name, country);
}

async function fetch7DayWeather(lat, lon) {
    try {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=7`
        );
        const data = await response.json();

        return {
            current: {
                temp: Math.round(data.current.temperature_2m),
                feelsLike: Math.round(data.current.apparent_temperature),
                humidity: data.current.relative_humidity_2m,
                wind: data.current.wind_speed_10m.toFixed(1),
                windGust: data.current.wind_gusts_10m ? data.current.wind_gusts_10m.toFixed(1) : '0.0',
                windDir: data.current.wind_direction_10m,
                pressure: Math.round(data.current.pressure_msl),
                cloudCover: data.current.cloud_cover,
                precipitation: data.current.precipitation.toFixed(1),
                weatherCode: data.current.weather_code
            },
            daily: data.daily
        };
    } catch (error) {
        console.error('Weather fetch error:', error);
        return null;
    }
}

async function fetch6MonthClimate(lat, lon) {
    try {
        const today = new Date();
        const monthlyData = [];

        for (let monthOffset = 0; monthOffset < 6; monthOffset++) {
            const futureMonth = new Date(today);
            futureMonth.setMonth(today.getMonth() + monthOffset);

            const month = futureMonth.getMonth() + 1;
            const year = futureMonth.getFullYear();

            let totalMaxTemp = 0;
            let totalMinTemp = 0;
            let totalPrecip = 0;
            let validYears = 0;

            for (let yearBack = 1; yearBack <= 10; yearBack++) {
                const histYear = year - yearBack;
                const startDate = `${histYear}-${String(month).padStart(2, '0')}-01`;
                const endDate = `${histYear}-${String(month).padStart(2, '0')}-28`;

                try {
                    const response = await fetch(
                        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
                    );
                    const data = await response.json();

                    if (data && data.daily && data.daily.temperature_2m_max) {
                        const maxTemps = data.daily.temperature_2m_max;
                        const minTemps = data.daily.temperature_2m_min;
                        const precips = data.daily.precipitation_sum;

                        totalMaxTemp += maxTemps.reduce((a, b) => a + b, 0) / maxTemps.length;
                        totalMinTemp += minTemps.reduce((a, b) => a + b, 0) / minTemps.length;
                        totalPrecip += precips.reduce((a, b) => a + b, 0);
                        validYears++;
                    }
                } catch (err) {
                    console.log(`Skipping year ${histYear}`);
                }
            }

            if (validYears > 0) {
                const avgMaxTemp = totalMaxTemp / validYears;
                const avgMinTemp = totalMinTemp / validYears;
                const avgPrecip = totalPrecip / validYears;

                monthlyData.push({
                    name: futureMonth.toLocaleString('default', { month: 'short' }),
                    fullName: futureMonth.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    highTemp: Math.round(avgMaxTemp),
                    lowTemp: Math.round(avgMinTemp),
                    avgTemp: Math.round((avgMaxTemp + avgMinTemp) / 2),
                    precipitation: Math.round(avgPrecip),
                    precipProb: Math.min(100, Math.round((avgPrecip / 30) * 100)),
                    weatherCode: avgPrecip > 50 ? 61 : (avgPrecip > 10 ? 3 : 0),
                    dataSource: `${validYears}-year avg`
                });
            }
        }

        return monthlyData;
    } catch (error) {
        console.error('Climate fetch error:', error);
        return null;
    }
}

function displayCurrentWeather(name, country, weatherData) {
    if (!weatherData) {
        document.getElementById('current-weather').innerHTML = '<p style="color: #666;">Unable to fetch data</p>';
        return null;
    }

    const current = weatherData.current;

    currentLocationData = {
        name: name,
        temp: current.temp,
        feelsLike: current.feelsLike,
        desc: getWeatherDesc(current.weatherCode),
        humidity: current.humidity,
        wind: current.wind,
        precipitation: current.precipitation,
        weatherCode: current.weatherCode
    };

    const html = `
        <div class="location-name">${name}, ${country}</div>
        <div class="weather-icon-large">${getWeatherIcon(current.weatherCode)}</div>
        <div class="temp-large">${current.temp}°C</div>
        <div class="weather-desc">${getWeatherDesc(current.weatherCode)}</div>
        
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-label">Feels Like</div>
                <div class="stat-value">${current.feelsLike}°C</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Humidity</div>
                <div class="stat-value">${current.humidity}%</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Wind</div>
                <div class="stat-value">${current.wind} km/h</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Pressure</div>
                <div class="stat-value">${current.pressure} hPa</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Cloud</div>
                <div class="stat-value">${current.cloudCover}%</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Rain</div>
                <div class="stat-value">${current.precipitation} mm</div>
            </div>
        </div>
    `;

    document.getElementById('current-weather').innerHTML = html;
    return weatherData;
}

function display7DayForecast(weatherData) {
    const daily = weatherData.daily;

    const ctx = document.getElementById('forecastChart').getContext('2d');

    if (forecastChart) {
        forecastChart.destroy();
    }

    const labels = daily.time.map(date => {
        const d = new Date(date);
        return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    });

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Max Temp (°C)',
                    data: daily.temperature_2m_max.map(t => Math.round(t)),
                    borderColor: '#ff6b35',
                    backgroundColor: 'rgba(255, 107, 53, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff6b35'
                },
                {
                    label: 'Min Temp (°C)',
                    data: daily.temperature_2m_min.map(t => Math.round(t)),
                    borderColor: '#00d9ff',
                    backgroundColor: 'rgba(0, 217, 255, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#00d9ff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#00d9ff',
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#00d9ff',
                    bodyColor: '#fff'
                }
            },
            scales: {
                y: {
                    ticks: { color: '#999', font: { size: 10 } },
                    grid: { color: 'rgba(0, 242, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#999', font: { size: 9 } },
                    grid: { color: 'rgba(0, 242, 255, 0.1)' }
                }
            }
        }
    });

    const dailyGrid = document.getElementById('daily-grid');
    dailyGrid.innerHTML = '';

    const totalDays = Math.min(7, daily.time.length);

    for (let i = 0; i < totalDays; i++) {
        const card = document.createElement('div');
        card.className = 'day-card';
        card.style.animationDelay = `${i * 0.1}s`;

        const date = new Date(daily.time[i]);
        const dayName = date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });

        const maxTemp = Math.round(daily.temperature_2m_max[i]);
        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const rainMm = daily.precipitation_sum[i].toFixed(1);
        const rainPercent = daily.precipitation_probability_max[i];
        const weatherCode = daily.weather_code[i];

        card.innerHTML = `
            <div class="day-name">${dayName}</div>
            <div class="day-icon">${getWeatherIcon(weatherCode)}</div>
            <div class="temp-range">
                <div class="temp-high">
                    🔥 ${maxTemp}°C
                </div>
                <div class="temp-low">
                    ❄️ ${minTemp}°C
                </div>
            </div>
            <div class="rain-info">
                <div class="rain-box">
                    <div class="rain-label">RAIN</div>
                    <div class="rain-value">${rainMm} mm</div>
                </div>
                <div class="rain-box">
                    <div class="rain-label">RAIN %</div>
                    <div class="rain-value">${rainPercent}%</div>
                </div>
            </div>
        `;
        dailyGrid.appendChild(card);
    }
}

function display6MonthForecast(monthlyData) {
    if (!monthlyData || monthlyData.length === 0) {
        document.getElementById('monthly-grid').innerHTML = '<p style="color: #666; grid-column: 1/-1; text-align: center; padding: 40px;">Loading climate data...</p>';
        return;
    }

    const ctx = document.getElementById('monthlyChart').getContext('2d');

    if (monthlyChart) {
        monthlyChart.destroy();
    }

    monthlyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthlyData.map(m => m.name),
            datasets: [
                {
                    label: 'High (°C)',
                    data: monthlyData.map(m => m.highTemp),
                    borderColor: '#ffd700',
                    backgroundColor: 'rgba(255, 215, 0, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Avg (°C)',
                    data: monthlyData.map(m => m.avgTemp),
                    borderColor: '#00d9ff',
                    backgroundColor: 'rgba(0, 217, 255, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Low (°C)',
                    data: monthlyData.map(m => m.lowTemp),
                    borderColor: '#7000ff',
                    backgroundColor: 'rgba(112, 0, 255, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#00d9ff',
                        font: { size: 10 }
                    }
                }
            },
            scales: {
                y: {
                    ticks: { color: '#999' },
                    grid: { color: 'rgba(0, 242, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#999' },
                    grid: { color: 'rgba(0, 242, 255, 0.1)' }
                }
            }
        }
    });

    const monthlyGrid = document.getElementById('monthly-grid');
    monthlyGrid.innerHTML = '';

    monthlyData.forEach((month, index) => {
        const card = document.createElement('div');
        card.className = 'day-card';
        card.style.animationDelay = `${index * 0.1}s`;
        card.innerHTML = `
            <div class="day-name">${month.fullName}</div>
            <div class="day-icon">${getWeatherIcon(month.weatherCode)}</div>
            <div class="temp-range">
                <div class="temp-high">🔥 ${month.highTemp}°C</div>
                <div class="temp-low">❄️ ${month.lowTemp}°C</div>
            </div>
            <div class="rain-info">
                <div class="rain-box">
                    <div class="rain-label">RAIN</div>
                    <div class="rain-value">${month.precipitation} mm</div>
                </div>
                <div class="rain-box">
                    <div class="rain-label">RAIN %</div>
                    <div class="rain-value">${month.precipProb}%</div>
                </div>
            </div>
            <div style="margin-top: 10px; font-size: 0.6rem; color: #666; text-align: center;">
                ${month.dataSource}
            </div>
        `;
        monthlyGrid.appendChild(card);
    });
}

async function loadWeatherData(lat, lon, name, country) {
    document.getElementById('current-weather').innerHTML = '<div class="loading-spinner"></div>';

    const weatherData = await fetch7DayWeather(lat, lon);
    const result = displayCurrentWeather(name, country, weatherData);

    if (result) {
        display7DayForecast(weatherData);
        checkAndNotifyAlerts(weatherData, name, country);
        updateJarvisLog(name, 'Loading climate...');

        const monthlyData = await fetch6MonthClimate(lat, lon);
        if (monthlyData && monthlyData.length > 0) {
            display6MonthForecast(monthlyData);
            updateJarvisLog(name, 'COMPLETE');
        }
    }
}

function updateJarvisLog(city, status = 'ACTIVE') {
    const messages = [
        `> Location: ${city} - LOCKED`,
        `> 7-Day forecast: ${status}`,
        `> 6-Month climate: ${status}`,
        `> Data: Open-Meteo API`,
        `> Historical: 10-year average`,
        `> Update: Every hour`,
        `> All systems: OPERATIONAL`
    ];

    let msgIndex = 0;
    let charIndex = 0;
    const el = document.getElementById('jarvis-text');
    el.innerHTML = '';

    function typeMessage() {
        if (msgIndex < messages.length) {
            if (charIndex < messages[msgIndex].length) {
                el.innerHTML += messages[msgIndex].charAt(charIndex);
                charIndex++;
                setTimeout(typeMessage, 15);
            } else {
                el.innerHTML += '<br>';
                msgIndex++;
                charIndex = 0;
                setTimeout(typeMessage, 250);
            }
        }
    }
    typeMessage();
}

async function searchLocation() {
    const query = document.getElementById('location-search').value.trim();
    if (!query) return;

    document.getElementById('current-weather').innerHTML = '<div class="loading-spinner"></div>';

    const cities = await searchCities(query);
    if (cities.length > 0) {
        const city = cities[0];
        selectCity(city.name, city.lat, city.lon, city.country);
    } else {
        document.getElementById('current-weather').innerHTML = '<p style="color: #666;">City not found</p>';
    }
}

document.getElementById('location-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchLocation();
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        document.getElementById('suggestions').classList.remove('active');
    }
});

window.onload = () => {
    const intro = document.getElementById('intro-screen');
    const app = document.getElementById('main-app');

    setTimeout(() => {
        intro.classList.add('warp-exit');
        app.classList.add('active-dash');

        setTimeout(() => {
            maybePromptEnableAlertsOnce();
            loadWeatherData(13.6288, 79.4192, 'Tirupati', 'India');
            lucide.createIcons();
        }, 500);
    }, 4500);
};
