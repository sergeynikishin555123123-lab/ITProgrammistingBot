from flask import Flask, render_template, jsonify

app = Flask(__name__)
app.secret_key = "codefarm-secret-key-2024"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/health')
def health():
    return jsonify({"status": "OK", "message": "CodeFarm работает!"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
