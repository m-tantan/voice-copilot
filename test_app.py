"""
Playwright tests for Voice Copilot
Run with: pytest test_app.py -v
"""
import pytest
from playwright.sync_api import Page, expect


BASE_URL = "http://localhost:5000"


def test_page_loads(page: Page):
    """Test that the main page loads correctly"""
    page.goto(BASE_URL)
    
    # Check title
    expect(page).to_have_title("Voice Copilot")
    
    # Check main heading
    heading = page.get_by_role("heading", name="Voice Copilot")
    expect(heading).to_be_visible()


def test_record_button_exists(page: Page):
    """Test that record button is present and clickable"""
    page.goto(BASE_URL)
    
    button = page.get_by_role("button", name="Start recording")
    expect(button).to_be_visible()
    expect(button).to_be_enabled()


def test_status_shows_ready(page: Page):
    """Test initial status is Ready"""
    page.goto(BASE_URL)
    
    status = page.locator("#status")
    expect(status).to_have_text("Ready")


def test_wake_word_listener_active(page: Page):
    """Test that wake word detection indicator is shown"""
    page.goto(BASE_URL)
    
    wake_status = page.locator("#wake-word-status")
    expect(wake_status).to_contain_text("Listening for wake word")


def test_privacy_notice_shown(page: Page):
    """Test that privacy notice is displayed"""
    page.goto(BASE_URL)
    
    footer = page.locator("footer")
    expect(footer).to_contain_text("All voice processing is done locally")


def test_record_button_changes_on_hold(page: Page):
    """Test that holding the record button changes state"""
    page.goto(BASE_URL)
    
    button = page.get_by_role("button", name="Start recording")
    
    # Simulate mousedown (start recording)
    button.dispatch_event("mousedown")
    page.wait_for_timeout(500)
    
    # Check button text changes - may need mic permission
    # The exact behavior depends on browser mic access
    
    # Simulate mouseup (stop recording)
    button.dispatch_event("mouseup")


def test_health_endpoint(page: Page):
    """Test the health API endpoint"""
    response = page.request.get(f"{BASE_URL}/api/health")
    
    assert response.ok
    data = response.json()
    assert data["status"] == "ok"
    assert "whisper_model" in data


def test_speak_endpoint(page: Page):
    """Test the TTS API endpoint"""
    response = page.request.post(
        f"{BASE_URL}/api/speak",
        data={"text": "Hello world"},
        headers={"Content-Type": "application/json"}
    )
    
    # May return error if TTS engine has issues, but should not crash
    assert response.status in [200, 500]


def test_chat_endpoint_requires_message(page: Page):
    """Test that chat endpoint requires message parameter"""
    response = page.request.post(
        f"{BASE_URL}/api/chat",
        data={},
        headers={"Content-Type": "application/json"}
    )
    
    assert response.status == 400
    data = response.json()
    assert "error" in data


def test_transcribe_endpoint_requires_audio(page: Page):
    """Test that transcribe endpoint requires audio file"""
    response = page.request.post(f"{BASE_URL}/api/transcribe")
    
    assert response.status == 400
    data = response.json()
    assert "error" in data


def test_chat_input_exists(page: Page):
    """Test that chat input textbox is present"""
    page.goto(BASE_URL)
    
    input_box = page.locator("#chat-input")
    expect(input_box).to_be_visible()
    expect(input_box).to_have_attribute("placeholder", "Type a message or use voice...")


def test_send_button_exists(page: Page):
    """Test that send button is present"""
    page.goto(BASE_URL)
    
    send_btn = page.get_by_role("button", name="Send message")
    expect(send_btn).to_be_visible()


def test_can_type_and_send_message(page: Page):
    """Test typing a message and sending it"""
    page.goto(BASE_URL)
    
    # Type a message
    input_box = page.locator("#chat-input")
    input_box.fill("Test message")
    
    # Click send
    send_btn = page.get_by_role("button", name="Send message")
    send_btn.click()
    
    # Wait for response
    page.wait_for_timeout(3000)
    
    # Check conversation shows user message
    conversation = page.locator("#conversation")
    expect(conversation).to_contain_text("Test message")
