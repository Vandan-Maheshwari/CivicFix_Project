document.addEventListener('DOMContentLoaded', function() {
    // Check if API client is available
    if (typeof CivicFixAPI === 'undefined') {
        console.error('API client not loaded. Please include api.js');
        return;
    }

    // Elements
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const authFooterText = document.getElementById('auth-footer-text');
    
    // Check if user is already logged in
    if (api.isAuthenticated()) {
        // Redirect to profile page if already authenticated
        window.location.href = 'profile.html';
        return;
    }
    
    // Toggle between login and signup
    function showLogin() {
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        authFooterText.innerHTML = 'Don\'t have an account? <a href="#" id="auth-switch-link">Sign up now</a>';
        attachSwitchEvent();
    }
    
    function showSignup() {
        loginTab.classList.remove('active');
        signupTab.classList.add('active');
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        authFooterText.innerHTML = 'Already have an account? <a href="#" id="auth-switch-link">Log in</a>';
        attachSwitchEvent();
    }
    
    function attachSwitchEvent() {
        const switchLink = document.getElementById('auth-switch-link');
        if (switchLink) {
            switchLink.addEventListener('click', function(e) {
                e.preventDefault();
                if (loginForm.style.display === 'block') {
                    showSignup();
                } else {
                    showLogin();
                }
            });
        }
    }
    
    // Tab click events
    loginTab.addEventListener('click', showLogin);
    signupTab.addEventListener('click', showSignup);
    
    // Password visibility toggle
    function setupPasswordToggle(passwordId, toggleId) {
        const passwordInput = document.getElementById(passwordId);
        const toggleButton = document.getElementById(toggleId);
        
        if (passwordInput && toggleButton) {
            toggleButton.addEventListener('click', function() {
                if (passwordInput.type === 'password') {
                    passwordInput.type = 'text';
                    toggleButton.innerHTML = '<i class="far fa-eye-slash"></i>';
                } else {
                    passwordInput.type = 'password';
                    toggleButton.innerHTML = '<i class="far fa-eye"></i>';
                }
            });
        }
    }
    
    setupPasswordToggle('login-password', 'toggle-login-password');
    setupPasswordToggle('signup-password', 'toggle-signup-password');
    setupPasswordToggle('signup-confirm', 'toggle-signup-confirm');
    
    // Mobile number validation and formatting
    function setupMobileValidation() {
        const mobileInputs = document.querySelectorAll('#signup-mobile, #login-mobile');
        
        mobileInputs.forEach(input => {
            if (!input) return;
            
            // Only allow numbers
            input.addEventListener('input', function(e) {
                let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
                
                // Limit to 10 digits
                if (value.length > 10) {
                    value = value.substring(0, 10);
                }
                
                e.target.value = value;
                
                // Real-time validation
                validateMobileNumber(e.target);
            });
            
            // Format on blur
            input.addEventListener('blur', function(e) {
                validateMobileNumber(e.target);
            });
        });
    }
    
    function validateMobileNumber(input) {
        const value = input.value.trim();
        const isValid = /^[6-9]\d{9}$/.test(value);
        
        // Get or create error element
        let errorElement = input.parentNode.querySelector('.mobile-error');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'mobile-error error-message';
            errorElement.style.display = 'none';
            input.parentNode.appendChild(errorElement);
        }
        
        if (value && !isValid) {
            input.classList.add('error');
            errorElement.textContent = 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9';
            errorElement.style.display = 'block';
            return false;
        } else {
            input.classList.remove('error');
            errorElement.style.display = 'none';
            return true;
        }
    }
    
    // Initialize mobile validation
    setupMobileValidation();
    
    // Form validation helpers
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    
    function showFieldError(fieldId, errorId, message) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(errorId);
        if (field && error) {
            field.classList.add('error');
            error.textContent = message;
            error.style.display = 'block';
        }
    }
    
    function hideFieldError(fieldId, errorId) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(errorId);
        if (field && error) {
            field.classList.remove('error');
            error.style.display = 'none';
        }
    }
    
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 350px;
            font-weight: 500;
            transition: opacity 0.5s;
        `;
        
        const colors = {
            success: '#2ecc71',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        notification.style.background = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 500);
        }, 4000);
    }
    
    // Login form submission
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form values
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        
        // Reset previous errors
        hideFieldError('login-email', 'login-email-error');
        hideFieldError('login-password', 'login-password-error');
        
        let isValid = true;
        
        // Email validation
        if (!email) {
            showFieldError('login-email', 'login-email-error', 'Email is required');
            isValid = false;
        } else if (!validateEmail(email)) {
            showFieldError('login-email', 'login-email-error', 'Please enter a valid email');
            isValid = false;
        }
        
        // Password validation
        if (!password) {
            showFieldError('login-password', 'login-password-error', 'Password is required');
            isValid = false;
        }
        
        if (!isValid) return;
        
        // Show loading state
        const submitBtn = loginForm.querySelector('.btn-auth');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Logging in...';
        submitBtn.disabled = true;
        
        try {
            const response = await api.login({ email, password });
            
            if (response.success) {
                showNotification('Login successful! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = 'home.html';
                }, 1000);
            }
        } catch (error) {
            console.error('Login error:', error);
            showNotification(error.message || 'Login failed. Please try again.', 'error');
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
    
    // Signup form submission
    signupForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form values
        const fullName = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const mobile = document.getElementById('signup-mobile').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm').value;
        const termsAgree = document.getElementById('terms-agree').checked;
        
        // Parse name
        const nameParts = fullName.split(' ');
        const name = nameParts[0] || '';
        const surname = nameParts.slice(1).join(' ') || '';
        
        // Reset previous errors
        hideFieldError('signup-name', 'signup-name-error');
        hideFieldError('signup-email', 'signup-email-error');
        hideFieldError('signup-mobile', 'signup-mobile-error');
        hideFieldError('signup-password', 'signup-password-error');
        hideFieldError('signup-confirm', 'signup-confirm-error');
        
        const termsError = document.getElementById('terms-error');
        if (termsError) termsError.style.display = 'none';
        
        let isValid = true;
        
        // Name validation
        if (!fullName) {
            showFieldError('signup-name', 'signup-name-error', 'Full name is required');
            isValid = false;
        } else if (fullName.split(' ').length < 2) {
            showFieldError('signup-name', 'signup-name-error', 'Please enter both first and last name');
            isValid = false;
        }
        
        // Email validation
        if (!email) {
            showFieldError('signup-email', 'signup-email-error', 'Email is required');
            isValid = false;
        } else if (!validateEmail(email)) {
            showFieldError('signup-email', 'signup-email-error', 'Please enter a valid email');
            isValid = false;
        }
        
        // Mobile validation
        if (!mobile) {
            showFieldError('signup-mobile', 'signup-mobile-error', 'Mobile number is required');
            isValid = false;
        } else if (!/^[6-9]\d{9}$/.test(mobile)) {
            showFieldError('signup-mobile', 'signup-mobile-error', 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9');
            isValid = false;
        }
        
        // Password validation
        if (!password) {
            showFieldError('signup-password', 'signup-password-error', 'Password is required');
            isValid = false;
        } else if (password.length < 6) {
            showFieldError('signup-password', 'signup-password-error', 'Password must be at least 6 characters');
            isValid = false;
        }
        
        // Confirm password validation
        if (password !== confirmPassword) {
            showFieldError('signup-confirm', 'signup-confirm-error', 'Passwords do not match');
            isValid = false;
        }
        
        // Terms validation
        if (!termsAgree) {
            if (termsError) {
                termsError.textContent = 'You must agree to the terms';
                termsError.style.display = 'block';
            }
            isValid = false;
        }
        
        if (!isValid) return;
        
        // Show loading state
        const submitBtn = signupForm.querySelector('.btn-auth');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Creating Account...';
        submitBtn.disabled = true;
        
        try {
            const userData = {
                name,
                surname: surname || 'User',
                email,
                mobile,
                password
            };
            
            const response = await api.register(userData);
            
            if (response.success) {
                showNotification('Account created successfully! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = 'home.html';
                }, 1000);
            } else {
            // This is the new logic to handle failed registration messages from the backend
            showNotification(response.message || 'Registration failed. Please check your details.', 'error');
            }
        } catch (error) {
            console.error('Registration error:', error);
            showNotification(error.message || 'Registration failed. Please try again.', 'error');
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
    
    // Social auth placeholders (implement as needed)
    document.querySelectorAll('.social-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const provider = this.classList.contains('google') ? 'Google' : 
                           this.classList.contains('facebook') ? 'Facebook' : 'Twitter';
            showNotification(`${provider} authentication coming soon!`, 'info');
        });
    });
    
    // Newsletter form submission
    const newsletterForm = document.querySelector('footer form');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const emailInput = this.querySelector('input[type="email"]');
            if (emailInput && emailInput.value) {
                showNotification('Thank you for subscribing to our newsletter!', 'success');
                emailInput.value = '';
            }
        });
    }
    
    // Initialize
    attachSwitchEvent();
    
    console.log('Login/Signup page loaded successfully with improved validation');
});