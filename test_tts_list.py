"""Test TTS with a long list to detect when it stops working"""
import pyttsx3
import time
import tempfile
import os

# Generate a long list of items to speak
test_items = [
    "Item one: Apple",
    "Item two: Banana", 
    "Item three: Cherry",
    "Item four: Date",
    "Item five: Elderberry",
    "Item six: Fig",
    "Item seven: Grape",
    "Item eight: Honeydew",
    "Item nine: Imbe",
    "Item ten: Jackfruit",
    "Item eleven: Kiwi",
    "Item twelve: Lemon",
    "Item thirteen: Mango",
    "Item fourteen: Nectarine",
    "Item fifteen: Orange",
    "Item sixteen: Papaya",
    "Item seventeen: Quince",
    "Item eighteen: Raspberry",
    "Item nineteen: Strawberry",
    "Item twenty: Tangerine",
]

def test_tts_sequential():
    """Test TTS by speaking each item sequentially and timing it"""
    print("=" * 60)
    print("TTS Sequential Test - Speaking items one by one")
    print("=" * 60)
    
    engine = pyttsx3.init()
    engine.setProperty('rate', 175)
    engine.setProperty('volume', 0.9)
    
    for i, item in enumerate(test_items, 1):
        print(f"\n[{i:02d}] Speaking: {item}")
        start = time.time()
        
        try:
            engine.say(item)
            engine.runAndWait()
            elapsed = time.time() - start
            print(f"     ✓ Completed in {elapsed:.2f}s")
        except Exception as e:
            print(f"     ✗ FAILED after {time.time() - start:.2f}s: {e}")
            break
    
    print("\n" + "=" * 60)
    print("Sequential test complete")
    print("=" * 60)


def test_tts_save_to_file():
    """Test TTS by saving each item to a file and checking file size"""
    print("=" * 60)
    print("TTS File Save Test - Saving items to WAV files")
    print("=" * 60)
    
    for i, item in enumerate(test_items, 1):
        print(f"\n[{i:02d}] Saving: {item}")
        start = time.time()
        
        try:
            engine = pyttsx3.init()
            engine.setProperty('rate', 175)
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path = tmp.name
            
            engine.save_to_file(item, tmp_path)
            engine.runAndWait()
            
            elapsed = time.time() - start
            
            if os.path.exists(tmp_path):
                size = os.path.getsize(tmp_path)
                print(f"     ✓ Saved {size:,} bytes in {elapsed:.2f}s")
                os.unlink(tmp_path)
                
                if size < 100:
                    print(f"     ⚠ WARNING: File suspiciously small!")
            else:
                print(f"     ✗ FAILED: File not created after {elapsed:.2f}s")
                
        except Exception as e:
            print(f"     ✗ FAILED after {time.time() - start:.2f}s: {e}")
            break
    
    print("\n" + "=" * 60)
    print("File save test complete")
    print("=" * 60)


def test_tts_full_list():
    """Test TTS with the entire list as one string"""
    print("=" * 60)
    print("TTS Full List Test - Speaking entire list at once")
    print("=" * 60)
    
    full_text = ". ".join(test_items)
    print(f"\nText length: {len(full_text)} characters")
    print(f"Preview: {full_text[:100]}...")
    
    start = time.time()
    try:
        engine = pyttsx3.init()
        engine.setProperty('rate', 175)
        engine.setProperty('volume', 0.9)
        
        print("\nSpeaking full list...")
        engine.say(full_text)
        engine.runAndWait()
        
        elapsed = time.time() - start
        print(f"\n✓ Completed full list in {elapsed:.2f}s")
        
    except Exception as e:
        print(f"\n✗ FAILED after {time.time() - start:.2f}s: {e}")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    print("\n🔊 TTS STRESS TEST\n")
    
    # Run tests
    test_tts_sequential()
    print("\n")
    test_tts_save_to_file()
    print("\n") 
    test_tts_full_list()
    
    print("\n🏁 All tests complete!")
