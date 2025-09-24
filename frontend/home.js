// Enhanced home.js with anonymous reporting using organizational identity
document.addEventListener("DOMContentLoaded", function () {
  // Check if API client is available
  if (typeof CivicFixAPI === 'undefined') {
    console.error('API client not loaded. Please include api.js');
    showError('System initialization failed. Please refresh the page.');
    return;
  }

  // Initialize API client
  const api = window.CivicFixAPI;

  // IMPORTANT: Using organizational identity instead of personal details
  // This is ethically and legally safer than using someone's personal information
  const DEFAULT_ANONYMOUS_USER = {
    name: "CivicFix",
    surname: "Support",
    email: "support@civicfix.org",
    mobile: "9999999999", // Generic placeholder - you should use your organization's number
    gender: "other",
    district: "Bhopal"
  };

  // Initialize the interactive map
  let map = L.map("interactive-map").setView([37.7749, -122.4194], 13);

  // Add OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Map controls and data
  let issueMarkers = [];
  let issuesVisible = false;
  let currentUser = null;
  let isUserAuthenticated = false;

  // Global variables for photo capture
  let stream = null;
  let locationAccess = false;
  let currentLocation = null;
  let capturedPhotoData = null;
  let capturedImageFile = null;
  let isLocationLocked = false;

  // Initialize authentication state and load user data
  initializeUserState();

  async function initializeUserState() {
    try {
      if (api.isAuthenticated()) {
        // Load user profile data
        const response = await api.getUserProfile();
        if (response.success) {
          currentUser = response.user;
          isUserAuthenticated = true;
          updateAuthUI();
          console.log('User authenticated:', currentUser.name);
        }
      } else {
        isUserAuthenticated = false;
        updateAuthUI();
        console.log('Anonymous user - using organizational identity for reports');
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
      isUserAuthenticated = false;
      updateAuthUI();
    }
  }

  function updateAuthUI() {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) return;
    
    if (isUserAuthenticated && currentUser) {
      authButtons.innerHTML = `
        <a href="profile.html" class="btn btn-login" style="margin-right: 15px;">
          <i class="fas fa-user"></i> ${currentUser.name}
        </a>
        <a href="#" id="logout-btn" class="btn btn-signup">Logout</a>
      `;
      
      // Add logout event listener
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (confirm('Are you sure you want to logout?')) {
            api.logout();
            window.location.reload();
          }
        });
      }
    } else {
      authButtons.innerHTML = `
        <a href="enter.html" class="btn btn-login">Login</a>
        <a href="enter.html" class="btn btn-signup">Sign up</a>
      `;
    }
  }

  // Utility functions
  function showError(message) {
    showNotification(message, 'error');
  }

  function showSuccess(message) {
    showNotification(message, 'success');
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

  // Load initial map data
  async function loadMapData() {
    try {
      const response = await api.getMapData();
      if (response.success) {
        updateMapMarkers(response.markers);
      }
    } catch (error) {
      console.error('Failed to load map data:', error);
    }
  }

  // Update map markers
  function updateMapMarkers(markers) {
    // Clear existing markers
    issueMarkers.forEach(marker => map.removeLayer(marker));
    issueMarkers = [];

    // Add new markers
    markers.forEach(issue => {
      const marker = L.marker([issue.latitude, issue.longitude]).addTo(map).bindPopup(`
        <div>
          <strong>${issue.category.charAt(0).toUpperCase() + issue.category.slice(1)}</strong><br>
          <p>${issue.description}</p>
          <small>Status: ${issue.status}</small><br>
          <small>Priority: ${issue.priority}</small><br>
          <small>Votes: ↑${issue.upvotes} ↓${issue.downvotes}</small>
        </div>
      `);
      issueMarkers.push(marker);
    });
  }

  // Locate user button functionality
  const locateMeBtn = document.getElementById("locate-me");
  locateMeBtn.addEventListener("click", function () {
    if (!navigator.geolocation) {
      showError("Geolocation is not supported by your browser");
      return;
    }

    locateMeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';

    navigator.geolocation.getCurrentPosition(
      async function (position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // Center map on user's location
        map.setView([lat, lng], 15);

        // Add a marker for the user's location
        L.marker([lat, lng]).addTo(map).bindPopup("Your Location").openPopup();

        // Load nearby reports
        try {
          const nearbyResponse = await api.getNearbyReports(lat, lng, 2000);
          if (nearbyResponse.success) {
            updateMapMarkers(nearbyResponse.reports);
          }
        } catch (error) {
          console.error('Failed to load nearby reports:', error);
        }

        locateMeBtn.innerHTML = '<i class="fas fa-location-arrow"></i> My Location';
      },
      function (error) {
        showError("Unable to get your location. Please check your location settings.");
        locateMeBtn.innerHTML = '<i class="fas fa-location-arrow"></i> My Location';
      }
    );
  });

  // Show/hide issues button functionality
  const showIssuesBtn = document.getElementById("show-issues");
  showIssuesBtn.addEventListener("click", async function () {
    if (issuesVisible) {
      // Hide issues
      issueMarkers.forEach(marker => map.removeLayer(marker));
      issueMarkers = [];
      showIssuesBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Show Issues';
    } else {
      // Show issues
      showIssuesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      await loadMapData();
      showIssuesBtn.innerHTML = '<i class="fas fa-times"></i> Hide Issues';
    }
    issuesVisible = !issuesVisible;
  });

  // Camera and photo capture functionality
  const cameraModal = document.getElementById("camera-modal");
  const openCameraBtn = document.getElementById("open-camera");
  const closeCameraBtn = document.getElementById("close-camera");
  const video = document.getElementById("video");
  const captureBtn = document.getElementById("capture-btn");
  const capturedPhoto = document.getElementById("captured-photo");
  const capturedImg = document.getElementById("captured-img");
  const retakePhotoBtn = document.getElementById("retake-photo");
  const usePhotoBtn = document.getElementById("use-photo");
  const cameraStatus = document.getElementById("camera-status");
  const photoLocationInfo = document.getElementById("photo-location-info");
  const photoPreview = document.getElementById("photo-preview");
  const previewImg = document.getElementById("preview-img");
  const locationDetails = document.getElementById("location-details");
  const locationInput = document.getElementById("location");
  const locationLockMessage = document.getElementById("location-lock-message");
  const cameraView = document.getElementById("camera-view");

  // Open camera modal
  openCameraBtn.addEventListener("click", function () {
    cameraModal.style.display = "flex";
    initCamera();
  });

  // Close camera modal
  closeCameraBtn.addEventListener("click", function () {
    closeCamera();
  });

  // Initialize camera
  async function initCamera() {
    try {
      cameraView.style.display = "block";
      capturedPhoto.style.display = "none";

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      video.srcObject = stream;
      cameraStatus.textContent = "Camera access granted. Requesting location access...";
      cameraStatus.className = "status success";

      requestLocation();
    } catch (err) {
      cameraStatus.textContent = "Error accessing camera: " + err.message;
      cameraStatus.className = "status error";
      console.error("Error accessing camera:", err);
    }
  }

  // Request location access
  function requestLocation() {
    if (!navigator.geolocation) {
      cameraStatus.textContent = "Geolocation is not supported by this browser.";
      cameraStatus.className = "status error";
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        locationAccess = true;
        currentLocation = position.coords;
        cameraStatus.textContent = "Location access granted. You can now take photos!";
        cameraStatus.className = "status success";
      },
      function (error) {
        cameraStatus.textContent = "Location access denied. Photos won't include location data.";
        cameraStatus.className = "status warning";
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // Capture photo
  captureBtn.addEventListener("click", function () {
    if (!stream) {
      cameraStatus.textContent = "Camera not available. Please allow camera access.";
      cameraStatus.className = "status error";
      return;
    }

    // Create canvas to capture the photo
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (locationAccess) {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          currentLocation = position.coords;
          capturePhoto(canvas);
        },
        function (error) {
          cameraStatus.textContent = "Could not get location. Saving photo without location.";
          cameraStatus.className = "status warning";
          capturePhoto(canvas);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      capturePhoto(canvas);
    }
  });

  // Capture photo and display preview
  function capturePhoto(canvas) {
    capturedPhotoData = canvas.toDataURL("image/jpeg", 0.8);
    capturedImg.src = capturedPhotoData;

    // Convert to file for API upload
    canvas.toBlob(function(blob) {
      capturedImageFile = new File([blob], 'captured_photo.jpg', { type: 'image/jpeg' });
    }, 'image/jpeg', 0.8);

    // Display location info if available
    if (currentLocation) {
      photoLocationInfo.innerHTML = `
        <div class="status success">
          <p>Location captured:</p>
          <p>Latitude: ${currentLocation.latitude.toFixed(6)}</p>
          <p>Longitude: ${currentLocation.longitude.toFixed(6)}</p>
          <p>Accuracy: ${currentLocation.accuracy.toFixed(2)} meters</p>
        </div>
      `;
    } else {
      photoLocationInfo.innerHTML = `
        <div class="status warning">
          <p>No location data available for this photo</p>
        </div>
      `;
    }

    cameraView.style.display = "none";
    capturedPhoto.style.display = "block";
    capturedPhoto.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Retake photo
  retakePhotoBtn.addEventListener("click", function () {
    capturedPhoto.style.display = "none";
    cameraView.style.display = "block";
    video.srcObject = stream;
  });

  // Use the captured photo
  usePhotoBtn.addEventListener("click", function () {
    previewImg.src = capturedPhotoData;
    photoPreview.style.display = "block";

    if (currentLocation) {
      const lat = currentLocation.latitude.toFixed(6);
      const lng = currentLocation.longitude.toFixed(6);
      locationDetails.innerHTML = `<strong>Location:</strong> Latitude: ${lat}, Longitude: ${lng}`;
      locationInput.value = `Lat: ${lat}, Lng: ${lng}`;
      lockLocationField();
    } else {
      locationDetails.innerHTML = `<strong>Location:</strong> No location data available`;
      locationInput.value = "Location not available";
      lockLocationField();
    }

    closeCamera();
    document.getElementById("report").scrollIntoView({ behavior: "smooth" });
  });

  // Lock/unlock location field
  function lockLocationField() {
    isLocationLocked = true;
    locationInput.classList.add("location-locked");
    locationLockMessage.style.display = "block";
  }

  function unlockLocationField() {
    isLocationLocked = false;
    locationInput.classList.remove("location-locked");
    locationLockMessage.style.display = "none";
    locationInput.value = "";
  }

  // Close camera and cleanup
  function closeCamera() {
    cameraModal.style.display = "none";
    capturedPhoto.style.display = "none";
    cameraView.style.display = "block";

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  // Create user form fields - NEW ANONYMOUS APPROACH
  function createUserFormFields() {
    const reportForm = document.querySelector('.report-form');
    if (!reportForm) return;

    // Check if user section already exists
    if (document.getElementById('user-section')) return;

    let userSectionHTML;

    if (isUserAuthenticated && currentUser) {
      // For authenticated users - show their info
      userSectionHTML = `
        <div id="user-section" class="user-section authenticated-user">
          <h3 style="margin: 20px 0 15px 0; color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px;">
            <i class="fas fa-user-check"></i> Your Information
          </h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div class="form-group">
              <label for="user-name">First Name *</label>
              <input type="text" class="form-control" id="user-name" value="${currentUser.name}" readonly style="background-color: #f8f9fa;">
            </div>
            <div class="form-group">
              <label for="user-surname">Last Name *</label>
              <input type="text" class="form-control" id="user-surname" value="${currentUser.surname}" readonly style="background-color: #f8f9fa;">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div class="form-group">
              <label for="user-email">Email Address *</label>
              <input type="email" class="form-control" id="user-email" value="${currentUser.email}" readonly style="background-color: #f8f9fa;">
            </div>
            <div class="form-group">
              <label for="user-mobile">Mobile Number *</label>
              <input type="tel" class="form-control" id="user-mobile" value="${currentUser.mobile}" readonly style="background-color: #f8f9fa;">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div class="form-group">
              <label for="user-gender">Gender</label>
              <select class="form-control" id="user-gender" disabled style="background-color: #f8f9fa;">
                <option value="${currentUser.gender || ''}">${currentUser.gender || 'Not specified'}</option>
              </select>
            </div>
            <div class="form-group">
              <label for="user-district">District/City *</label>
              <input type="text" class="form-control" id="user-district" value="${currentUser.district || ''}" placeholder="Update your district">
            </div>
          </div>
          <div class="user-info-note" style="background: #e8f4fd; padding: 12px; border-radius: 5px; margin-bottom: 20px; font-size: 0.9rem; border-left: 4px solid #3498db;">
            <i class="fas fa-info-circle" style="color: #3498db;"></i> 
            Your profile information is pre-filled. You can update your district/city if needed.
          </div>
        </div>
      `;
    } else {
      // For anonymous users - show clean anonymous reporting interface
      userSectionHTML = `
        <div id="user-section" class="user-section anonymous-user">
          <div class="anonymous-report-section" style="background: linear-gradient(135deg, #e8f4fd 0%, #f8f9fa 100%); border: 1px solid #3498db; border-radius: 10px; padding: 20px; margin-bottom: 25px;">
            <h3 style="margin: 0 0 15px 0; color: #2c3e50; display: flex; align-items: center; gap: 10px;">
              <i class="fas fa-shield-alt" style="color: #3498db;"></i> Anonymous Report
            </h3>
            <div class="anonymous-info-note">
              <i class="fas fa-info-circle" style="color: #3498db; margin-right: 8px;"></i>
              <strong>Quick & Private:</strong> Report issues without providing personal information. Your report will be submitted to authorities on behalf of the CivicFix community.
              <br><br>
              <div class="anonymous-benefits" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(52, 152, 219, 0.2);">
                <div class="anonymous-benefit" style="display: flex; align-items: center; margin-bottom: 8px;">
                  <i class="fas fa-check-circle" style="color: #27ae60; margin-right: 8px;"></i>
                  <span style="font-size: 0.9rem;">No personal info required</span>
                </div>
                <div class="anonymous-benefit" style="display: flex; align-items: center; margin-bottom: 8px;">
                  <i class="fas fa-check-circle" style="color: #27ae60; margin-right: 8px;"></i>
                  <span style="font-size: 0.9rem;">Fast issue reporting</span>
                </div>
                <div class="anonymous-benefit" style="display: flex; align-items: center;">
                  <i class="fas fa-user-plus" style="color: #3498db; margin-right: 8px;"></i>
                  <span style="font-size: 0.9rem;"><a href="enter.html" style="color: #3498db; font-weight: 600; text-decoration: none;">Create account</a> to track reports & earn points</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Hidden fields with organizational default values -->
          <input type="hidden" id="user-name" value="${DEFAULT_ANONYMOUS_USER.name}">
          <input type="hidden" id="user-surname" value="${DEFAULT_ANONYMOUS_USER.surname}">
          <input type="hidden" id="user-email" value="${DEFAULT_ANONYMOUS_USER.email}">
          <input type="hidden" id="user-mobile" value="${DEFAULT_ANONYMOUS_USER.mobile}">
          <input type="hidden" id="user-gender" value="${DEFAULT_ANONYMOUS_USER.gender}">
          <input type="hidden" id="user-district" value="${DEFAULT_ANONYMOUS_USER.district}">
        </div>
      `;
    }

    // Create user section
    const userSection = document.createElement('div');
    userSection.innerHTML = userSectionHTML;

    // Insert user section before issue type field
    const issueTypeGroup = reportForm.querySelector('.form-group');
    if (issueTypeGroup) {
      reportForm.insertBefore(userSection, issueTypeGroup);
    }

    // Setup mobile validation only for authenticated users
    if (isUserAuthenticated) {
      setupMobileValidation();
    }
  }

  // Mobile number validation for authenticated users
  function setupMobileValidation() {
    const mobileInput = document.getElementById('user-mobile');
    if (!mobileInput || mobileInput.readOnly) return;

    mobileInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 10) {
        value = value.substring(0, 10);
      }
      e.target.value = value;
      validateMobileNumber(e.target);
    });

    mobileInput.addEventListener('blur', function(e) {
      validateMobileNumber(e.target);
    });
  }

  function validateMobileNumber(input) {
    const value = input.value.trim();
    const isValid = /^[6-9]\d{9}$/.test(value);
    
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

  // Create and handle report form submission
  function createReportForm() {
    const reportSection = document.getElementById('report');
    if (!reportSection) return;

    let existingForm = reportSection.querySelector('form');
    if (existingForm) {
      existingForm.remove();
    }

    const form = document.createElement('form');
    form.id = 'report-form';
    form.innerHTML = `
      <button type="submit" class="btn btn-signup" style="width: 100%; padding: 15px; margin-top: 20px;">
        <i class="fas fa-paper-plane"></i> Submit Report
      </button>
    `;

    // Insert form after the existing report form content
    const reportForm = document.querySelector('.report-form');
    const submitButton = reportForm.querySelector('button');
    if (submitButton) {
      submitButton.remove();
    }
    reportForm.appendChild(form);

    // Add form submission handler
    form.addEventListener('submit', handleReportSubmission);
  }

  async function handleReportSubmission(e) {
    e.preventDefault();
    await submitReport();
  }

  // UPDATED SUBMIT REPORT FUNCTION
  async function submitReport() {
    try {
      // Ensure user form fields exist
      createUserFormFields();

      // Get form data - for anonymous users, these come from hidden fields with organizational info
      const name = document.getElementById('user-name')?.value.trim() || DEFAULT_ANONYMOUS_USER.name;
      const surname = document.getElementById('user-surname')?.value.trim() || DEFAULT_ANONYMOUS_USER.surname;
      const email = document.getElementById('user-email')?.value.trim() || DEFAULT_ANONYMOUS_USER.email;
      const mobile = document.getElementById('user-mobile')?.value.trim() || DEFAULT_ANONYMOUS_USER.mobile;
      const gender = document.getElementById('user-gender')?.value || DEFAULT_ANONYMOUS_USER.gender;
      const district = document.getElementById('user-district')?.value.trim() || DEFAULT_ANONYMOUS_USER.district;
      const issueType = document.getElementById('issue-type')?.value || '';
      const description = document.getElementById('description')?.value.trim() || '';
      
      // Validation - only validate visible/required fields
      const validationErrors = [];

      // For authenticated users, validate their visible input fields
      if (isUserAuthenticated) {
        if (!name) validationErrors.push('First name is required');
        if (!surname) validationErrors.push('Last name is required');
        if (!email) validationErrors.push('Email is required');
        if (!mobile) validationErrors.push('Mobile number is required');
        if (!district) validationErrors.push('District/city is required');

        // Email validation
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          validationErrors.push('Please enter a valid email address');
        }

        // Mobile number validation
        if (mobile && !/^[6-9][0-9]{9}$/.test(mobile.replace(/\D/g, ''))) {
          validationErrors.push('Please enter a valid 10-digit mobile number starting with 6-9');
        }
      }

      // Photo validation
      if (!capturedImageFile && !capturedPhotoData) {
        validationErrors.push('Please take a photo of the issue first');
      }

      if (validationErrors.length > 0) {
        showError('Please fix the following errors:\n• ' + validationErrors.join('\n• '));
        return;
      }

      // Prepare report data
      const reportData = {
        name: name,
        surname: surname,
        email: email,
        mobile: mobile.replace(/\D/g, ''), // Clean mobile number
        gender: gender,
        district: district,
        category: issueType,
        description: description,
        latitude: currentLocation ? currentLocation.latitude : null,
        longitude: currentLocation ? currentLocation.longitude : null,
        address: locationInput?.value || ''
      };

      // Show loading state
      const submitBtn = document.querySelector('#report-form button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
      submitBtn.disabled = true;

      // Submit report
      let response;
      if (capturedImageFile) {
        response = await api.submitReport(reportData, capturedImageFile);
      } else {
        // Use base64 data if file is not available
        reportData.image_base64 = capturedPhotoData;
        response = await api.submitReport(reportData);
      }
      
      if (response.success) {
        const successMessage = isUserAuthenticated 
          ? `Report submitted successfully! ${response.auto_submitted ? 'Your report has been automatically forwarded to authorities.' : ''} Thank you for helping improve the community.`
          : `Anonymous report submitted successfully! ${response.auto_submitted ? 'Your report has been forwarded to authorities on behalf of the CivicFix community.' : ''} Thank you for helping improve Bhopal.`;
        
        showSuccess(successMessage);
        
        // Reset form
        resetReportForm();
        
        // Reload map data to show new report
        if (issuesVisible) {
          await loadMapData();
        }

        // Show different messages for authenticated vs anonymous users
        if (isUserAuthenticated) {
          setTimeout(() => {
            if (confirm('Would you like to view your report in your profile?')) {
              window.location.href = 'profile.html';
            }
          }, 2000);
        } else {
          setTimeout(() => {
            if (confirm('Report submitted successfully! Would you like to create an account to track your reports and earn points?')) {
              window.location.href = 'enter.html';
            }
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Failed to submit report:', error);
      showError('Failed to submit report: ' + (error.message || 'Unknown error'));
    } finally {
      // Reset button state
      const submitBtn = document.querySelector('#report-form button[type="submit"]');
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Report';
        submitBtn.disabled = false;
      }
    }
  }

  // Reset report form after successful submission
  function resetReportForm() {
    // Reset form fields
    const issueType = document.getElementById('issue-type');
    const description = document.getElementById('description');
    
    if (issueType) issueType.value = '';
    if (description) description.value = '';
    
    // Reset photo and location data
    photoPreview.style.display = 'none';
    unlockLocationField();
    capturedImageFile = null;
    capturedPhotoData = null;
    currentLocation = null;
    
    // For authenticated users, only reset district if they were editing it
    if (isUserAuthenticated) {
      // Keep their profile info, just reset the district field if it was editable
      const districtField = document.getElementById('user-district');
      if (districtField && !districtField.readOnly) {
        // Don't reset - let them keep their district
      }
    } else {
      // For anonymous users, the hidden fields stay as they are with default values
      // No need to reset hidden fields
    }
  }

  // Load leaderboard data
  async function loadLeaderboard() {
    try {
      const response = await api.getLeaderboard(5);
      if (response.success) {
        updateLeaderboardTable(response.leaderboard);
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    }
  }

  // Update leaderboard table
  function updateLeaderboardTable(leaderboard) {
    const tbody = document.querySelector('.leaderboard-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (leaderboard && leaderboard.length > 0) {
      leaderboard.forEach((user, index) => {
        const row = tbody.insertRow();
        row.innerHTML = `
          <td>${index + 1}</td>
          <td>${user.name}</td>
          <td>${user.reports || 0}</td>
          <td>${user.points || 0}</td>
        `;
      });
    } else {
      const row = tbody.insertRow();
      row.innerHTML = '<td colspan="4" style="text-align: center;">Loading leaderboard data...</td>';
    }
  }

  // Navigation and smooth scrolling
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href");
      if (targetId === "#") return;

      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        window.scrollTo({
          top: targetElement.offsetTop - 80,
          behavior: "smooth",
        });
      }
    });
  });

  // Hero report button
  document.querySelector(".btn-report").addEventListener("click", function () {
    window.scrollTo({
      top: document.getElementById("report").offsetTop - 80,
      behavior: "smooth",
    });
  });

  // Handle camera button for new photos (unlock location)
  openCameraBtn.addEventListener("click", function () {
    if (isLocationLocked) {
      unlockLocationField();
      photoPreview.style.display = "none";
    }
  });

  // Newsletter form submission
  const newsletterForm = document.querySelector('footer form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const emailInput = this.querySelector('input[type="email"]');
      if (emailInput && emailInput.value) {
        showSuccess('Thank you for subscribing to our newsletter!');
        emailInput.value = '';
      }
    });
  }

  // Initialize page
  async function initializePage() {
    try {
      // Create the report form
      createReportForm();
      
      // Create user form fields based on authentication status
      createUserFormFields();
      
      // Load initial data
      await Promise.all([
        loadMapData(),
        loadLeaderboard()
      ]);
      
      // Show welcome message based on user status
      if (isUserAuthenticated) {
        showSuccess(`Welcome back, ${currentUser.name}! Your information is pre-filled for faster reporting.`);
      } else {
        showNotification('Welcome! You can report issues anonymously, or sign up to track your reports and earn points.', 'info');
      }
      
    } catch (error) {
      console.error('Failed to initialize page:', error);
      showError('Failed to initialize page. Please refresh and try again.');
    }
  }

  // Start initialization
  initializePage();

  console.log('Home page initialized successfully with anonymous organizational reporting');
});