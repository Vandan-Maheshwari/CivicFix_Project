# submit_rpa.py - Updated for Anonymous Report Handling
# Author: CivicFix Team
# This script fetches complaints marked as ready for submission from MongoDB,
# automatically submits them using Selenium with proper anonymous handling,
# and updates their status.

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime
import time
import gridfs
import tempfile
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------------------
# Configuration
# ------------------------------
GOVERNMENT_FORM_URL = "file:///path/to/complaintform2.html"  # Update with actual government form URL
MAX_RETRIES = 3
SUBMISSION_DELAY = 2  # seconds between submissions to avoid overwhelming the server

# Anonymous user configuration (should match backend)
ANONYMOUS_USER_CONFIG = {
    "name": "CivicFix",
    "surname": "Support", 
    "email": "support@civicfix.org",
    "mobile": "9999999999",
    "gender": "Other",
    "district": "Bhopal"
}

# ------------------------------
# MongoDB setup
# ------------------------------
try:
    client = MongoClient("mongodb+srv://civicfix_user:civicfix_25@civicfix-cluster.jweittl.mongodb.net/")
    db = client["civicfix_user"]
    complaints = db["complaints"]
    fs = gridfs.GridFS(db)
    logger.info("MongoDB connection successful")
except Exception as e:
    logger.error(f"MongoDB connection failed: {e}")
    exit(1)

# ------------------------------
# Helper Functions
# ------------------------------
def get_field(complaint, field_name, default=""):
    """Safely get a field from complaint dict with fallback default"""
    return complaint.get(field_name, default)

def is_anonymous_report(complaint):
    """Check if this is an anonymous report"""
    return complaint.get('is_anonymous', False)

def get_display_info(complaint):
    """Get display information for anonymous vs authenticated reports"""
    if is_anonymous_report(complaint):
        return {
            'name': ANONYMOUS_USER_CONFIG['name'],
            'surname': ANONYMOUS_USER_CONFIG['surname'],
            'email': ANONYMOUS_USER_CONFIG['email'],
            'mobile': ANONYMOUS_USER_CONFIG['mobile'],
            'gender': ANONYMOUS_USER_CONFIG['gender'],
            'district': complaint.get('district', ANONYMOUS_USER_CONFIG['district']),
            'description': f"[Community Report] {complaint.get('description', '')}"
        }
    else:
        return {
            'name': get_field(complaint, "name"),
            'surname': get_field(complaint, "surname"),
            'email': get_field(complaint, "email"),
            'mobile': get_field(complaint, "mobile"),
            'gender': get_field(complaint, "gender", "Male"),
            'district': get_field(complaint, "district"),
            'description': get_field(complaint, "description")
        }

def wait_for_element(driver, by, value, timeout=10):
    """Wait for element to be present and return it"""
    try:
        element = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((by, value))
        )
        return element
    except Exception as e:
        logger.error(f"Element not found: {by}={value}, Error: {e}")
        return None

def safe_send_keys(driver, by, value, text):
    """Safely send keys to an element"""
    try:
        element = wait_for_element(driver, by, value)
        if element:
            element.clear()
            element.send_keys(text)
            return True
        return False
    except Exception as e:
        logger.error(f"Failed to send keys to {by}={value}: {e}")
        return False

def safe_select_option(driver, by, value, option_text):
    """Safely select an option from dropdown"""
    try:
        element = wait_for_element(driver, by, value)
        if element:
            select = Select(element)
            select.select_by_visible_text(option_text)
            return True
        return False
    except Exception as e:
        logger.error(f"Failed to select option {option_text} from {by}={value}: {e}")
        return False

def submit_complaint(driver, complaint):
    """Fill out and submit complaint form using Selenium"""
    try:
        # Refresh page and wait for it to load
        driver.refresh()
        time.sleep(2)

        # Get display information based on report type
        display_info = get_display_info(complaint)
        
        logger.info(f"Submitting {'anonymous' if is_anonymous_report(complaint) else 'authenticated'} report: {complaint['_id']}")

        # Fill form fields
        if not safe_send_keys(driver, By.NAME, "mobile", display_info['mobile']):
            raise Exception("Failed to fill mobile field")
            
        if not safe_send_keys(driver, By.NAME, "name", display_info['name']):
            raise Exception("Failed to fill name field")
            
        if not safe_send_keys(driver, By.NAME, "surname", display_info['surname']):
            raise Exception("Failed to fill surname field")
            
        if not safe_send_keys(driver, By.NAME, "email", display_info['email']):
            raise Exception("Failed to fill email field")

        # Select gender
        if not safe_select_option(driver, By.NAME, "gender", display_info['gender']):
            logger.warning("Failed to select gender, continuing...")

        # Fill address fields
        if not safe_send_keys(driver, By.NAME, "district", display_info['district']):
            raise Exception("Failed to fill district field")
            
        safe_send_keys(driver, By.NAME, "block", get_field(complaint, "block_name"))
        safe_send_keys(driver, By.NAME, "address", get_field(complaint, "address", "Community reported issue"))

        # Select complaint type
        area_type = get_field(complaint, "area_type", "Urban").title()
        if not safe_select_option(driver, By.NAME, "type", area_type):
            logger.warning("Failed to select area type, continuing...")

        # Fill department
        if not safe_send_keys(driver, By.NAME, "department", get_field(complaint, "department")):
            logger.warning("Failed to fill department, continuing...")

        # Select category
        category_mapping = {
            'pothole': 'Pothole',
            'garbage': 'Garbage',
            'streetlight': 'Street Light', 
            'water_supply': 'Water Supply',
            'sewer': 'Sewer',
            'road_repair': 'Road Repair',
            'other': 'Other'
        }
        
        category_display = category_mapping.get(complaint.get('category'), 'Other')
        if not safe_select_option(driver, By.NAME, "category", category_display):
            logger.warning("Failed to select category, continuing...")

        # Fill description
        if not safe_send_keys(driver, By.NAME, "description", display_info['description']):
            raise Exception("Failed to fill description field")

        # Handle file upload (optional)
        file_id = get_field(complaint, "file_path", "")
        if file_id:
            try:
                file_data = fs.get(ObjectId(file_id)).read()
                with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                    tmp.write(file_data)
                    tmp.flush()
                    
                    file_input = wait_for_element(driver, By.NAME, "file")
                    if file_input:
                        file_input.send_keys(tmp.name)
                        logger.info(f"File uploaded successfully for complaint {complaint['_id']}")
                        
                os.unlink(tmp.name)  # cleanup temp file
                
            except Exception as e:
                logger.warning(f"File upload failed for {complaint['_id']}: {e}")

        # Submit the form
        submit_button = wait_for_element(driver, By.XPATH, "//button[@type='submit']")
        if submit_button:
            submit_button.click()
            time.sleep(SUBMISSION_DELAY)
            logger.info(f"Form submitted for complaint {complaint['_id']}")
        else:
            raise Exception("Submit button not found")

        # Update complaint status in MongoDB
        update_data = {
            'submitted': 1,
            'submitted_at': datetime.utcnow(),
            'status': 'submitted',
            'rpa_submission_method': 'selenium',
            'submission_timestamp': datetime.utcnow()
        }
        
        # Add anonymous submission flag
        if is_anonymous_report(complaint):
            update_data['anonymous_submission_confirmed'] = True
            
        complaints.update_one(
            {"_id": complaint["_id"]},
            {"$set": update_data}
        )
        
        logger.info(f"✅ Complaint ID {complaint['_id']} ({'anonymous' if is_anonymous_report(complaint) else 'authenticated'}) submitted and updated in database")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to submit complaint {complaint['_id']}: {e}")
        
        # Mark as failed in database
        complaints.update_one(
            {"_id": complaint["_id"]},
            {"$set": {
                'submission_failed': True,
                'submission_error': str(e),
                'last_attempt': datetime.utcnow()
            }}
        )
        return False

def setup_driver():
    """Setup Chrome WebDriver with appropriate options"""
    try:
        chrome_options = webdriver.ChromeOptions()
        chrome_options.add_argument('--headless')  # Run in background
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        driver.implicitly_wait(10)
        
        return driver
    except Exception as e:
        logger.error(f"Failed to setup WebDriver: {e}")
        raise

# ------------------------------
# Main RPA Runner
# ------------------------------
def run_rpa_submission():
    """Main function to process and submit pending complaints"""
    logger.info("🚀 Starting RPA submission bot...")
    
    driver = None
    try:
        # Setup WebDriver
        driver = setup_driver()
        
        # Navigate to the complaint form
        logger.info(f"Navigating to: {GOVERNMENT_FORM_URL}")
        driver.get(GOVERNMENT_FORM_URL)
        time.sleep(3)

        # Fetch all complaints marked for submission but not yet processed
        pending_complaints = list(complaints.find({
            "submitted": 0,
            "status": {"$in": ["pending", "ready_for_submission"]},
            "submission_failed": {"$ne": True}
        }).sort("created_at", 1))  # Process oldest first

        if not pending_complaints:
            logger.info("No pending complaints found for submission")
            return

        logger.info(f"Found {len(pending_complaints)} complaints ready for submission")
        
        # Statistics tracking
        success_count = 0
        failure_count = 0
        anonymous_count = 0
        authenticated_count = 0

        # Process each complaint
        for complaint in pending_complaints:
            try:
                # Track report types
                if is_anonymous_report(complaint):
                    anonymous_count += 1
                else:
                    authenticated_count += 1
                
                # Attempt submission with retries
                submission_success = False
                for attempt in range(MAX_RETRIES):
                    try:
                        logger.info(f"Attempting to submit complaint {complaint['_id']} (attempt {attempt + 1}/{MAX_RETRIES})")
                        
                        if submit_complaint(driver, complaint):
                            submission_success = True
                            success_count += 1
                            break
                        else:
                            logger.warning(f"Submission attempt {attempt + 1} failed for complaint {complaint['_id']}")
                            
                    except Exception as e:
                        logger.error(f"Submission attempt {attempt + 1} failed for complaint {complaint['_id']}: {e}")
                        if attempt < MAX_RETRIES - 1:
                            logger.info(f"Retrying in 5 seconds...")
                            time.sleep(5)
                
                if not submission_success:
                    failure_count += 1
                    logger.error(f"All submission attempts failed for complaint {complaint['_id']}")
                
                # Brief delay between submissions
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Unexpected error processing complaint {complaint['_id']}: {e}")
                failure_count += 1

    except Exception as e:
        logger.error(f"Critical error in RPA submission: {e}")
        
    finally:
        if driver:
            driver.quit()
            logger.info("WebDriver closed")

    # Log final statistics
    logger.info("=" * 60)
    logger.info("RPA Submission Complete")
    logger.info("=" * 60)
    logger.info(f"Total complaints processed: {success_count + failure_count}")
    logger.info(f"Successful submissions: {success_count}")
    logger.info(f"Failed submissions: {failure_count}")
    logger.info(f"Anonymous reports submitted: {anonymous_count}")
    logger.info(f"Authenticated reports submitted: {authenticated_count}")
    logger.info(f"Success rate: {(success_count / max(success_count + failure_count, 1)) * 100:.1f}%")
    logger.info("=" * 60)

    return {
        'total_processed': success_count + failure_count,
        'successful': success_count,
        'failed': failure_count,
        'anonymous_submitted': anonymous_count,
        'authenticated_submitted': authenticated_count
    }

def update_failed_submissions():
    """Mark old failed submissions for retry"""
    try:
        from datetime import timedelta
        
        # Mark submissions that failed more than 1 hour ago for retry
        one_hour_ago = datetime.utcnow() - timedelta(hours=1)
        
        result = complaints.update_many(
            {
                'submission_failed': True,
                'last_attempt': {'$lt': one_hour_ago}
            },
            {
                '$unset': {
                    'submission_failed': '',
                    'submission_error': ''
                }
            }
        )
        
        if result.modified_count > 0:
            logger.info(f"Reset {result.modified_count} failed submissions for retry")
            
    except Exception as e:
        logger.error(f"Failed to update failed submissions: {e}")

if __name__ == "__main__":
    try:
        # Reset old failed submissions
        update_failed_submissions()
        
        # Run the main RPA process
        results = run_rpa_submission()
        
        # Log results to database for monitoring
        try:
            db['rpa_logs'].insert_one({
                'timestamp': datetime.utcnow(),
                'results': results,
                'status': 'completed'
            })
        except Exception as e:
            logger.error(f"Failed to log RPA results: {e}")
            
    except Exception as e:
        logger.error(f"RPA script failed: {e}")
        
        # Log failure to database
        try:
            db['rpa_logs'].insert_one({
                'timestamp': datetime.utcnow(),
                'error': str(e),
                'status': 'failed'
            })
        except:
            pass  # Don't fail if logging fails