
// Global GL object.
// Consciously not allowing multiple GL contexts as there is an upper limit in browsers and it's far more efficient to use a
// full-page context and render into that using scissoring.
let gl = null;

function assert(condition, message)
{
    if (!condition)
    {
        throw new Error(message || "Assertion failed");
    }
}

function glCompileShader(type, name, source)
{
    console.log("Compiling " + name);

    // Compile the shader
    let shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    // Report any errors
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        console.log("Error compiling " + name);
        console.log(gl.getShaderInfoLog(shader));
        console.trace();
    }

    return shader;
}

function glCreateProgram(vshader, fshader)
{
    // Attach shaders and link
    let program = gl.createProgram();
    gl.attachShader(program, vshader);
    gl.attachShader(program, fshader);
    gl.linkProgram(program);

    // Report any errors
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        console.log("Failed to link program");
        console.trace();
    }

    return program;
}

function glSetUniform(program, name, value, index)
{
    // Get location
    const location = gl.getUniformLocation(program, name);
    assert(location != null, "Can't find uniform " + name);

    // Dispatch to uniform function by type
    assert(value != null, "Value is null");
    const type = Object.prototype.toString.call(value).slice(8, -1);
    switch (type)
    {
        case "Number":
            gl.uniform1f(location, value);
            break;

        case "WebGLTexture":
            gl.activeTexture(gl.TEXTURE0 + index);
            gl.bindTexture(gl.TEXTURE_2D, value);
            gl.uniform1i(location, index);
            break;
        
        default:
            assert(false, "Unhandled type " + type);
            break;
    }
}

function glCreateTexture(width, height, data)
{
    const texture = gl.createTexture();

    // Set filtering/wrapping to nearest/clamp
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

    return texture;
}

const glDynamicBufferType = Object.freeze({
    Buffer: 1,
    Texture: 2
});

class glDynamicBuffer
{
    constructor(element_type, nb_elements, nb_entries, buffer_type)
    {
        this.elementType = element_type;
        this.nbElements = nb_elements;
        this.bufferType = buffer_type == undefined ? glDynamicBufferType.Buffer : buffer_type;
        this.dirty = false;

        this.Resize(nb_entries);
    }

    BindAsInstanceAttribute(program, attrib_name)
    {
        assert(this.bufferType == glDynamicBufferType.Buffer, "Can only call BindAsInstanceAttribute with Buffer types");

		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

        // The attribute referenced in the program
        const attrib_location = gl.getAttribLocation(program, attrib_name);

        gl.enableVertexAttribArray(attrib_location);
        gl.vertexAttribPointer(attrib_location, this.nbElements, this.elementType, false, 0, 0);

        // One per instance
        gl.vertexAttribDivisor(attrib_location, 1);
    }

    UploadData()
    {
        switch (this.bufferType)
        {
            case glDynamicBufferType.Buffer:
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cpuArray);
                break;

            case glDynamicBufferType.Texture:
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, this.nbEntries, 1, 0, gl.ALPHA, gl.UNSIGNED_BYTE, this.cpuArray);
                break;
        }
    }

    UploadDirtyData()
    {
        if (this.dirty)
        {
            this.UploadData();
            this.dirty = false;
        }
    }

    ResizeToFitNextPow2(target_count)
    {
        let nb_entries = this.nbEntries;
        while (target_count > nb_entries)
        {
            nb_entries <<= 1;
        }

        if (nb_entries > this.nbEntries)
        {
            this.Resize(nb_entries);
        }
    }

    Resize(nb_entries)
    {
        this.nbEntries = nb_entries;

        // Create the CPU array
        const old_array = this.cpuArray;
        switch (this.elementType)
        {
            case gl.FLOAT:
                this.nbElementBytes = 4;
                this.cpuArray = new Float32Array(this.nbElements * this.nbEntries);
                break;
            
            case gl.BYTE:
                this.nbElementBytes = 1;
                this.cpuArray = new Uint8Array(this.nbElements * this.nbEntries);
                break;

            default:
                assert(false, "Unsupported dynamic buffer element type");
        }

        // Calculate byte size of the buffer
        this.nbBytes = this.nbElementBytes * this.nbElements * this.nbEntries;

        if (old_array != undefined)
        {
            // Copy the values of the previous array over
            this.cpuArray.set(old_array);

            console.log(`glDynamicBuffer: Resizing to ${nb_entries} entries, ${this.nbElements} elements per entry, ${this.nbElementBytes} bytes per element, ${this.nbBytes} bytes total.`);
        }
        else
        {
            console.log(`glDynamicBuffer: Creating ${nb_entries} entries, ${this.nbElements} elements per entry, ${this.nbElementBytes} bytes per element, ${this.nbBytes} bytes total.`);
        }

        // Create the GPU buffer
        switch (this.bufferType)
        {
            case glDynamicBufferType.Buffer:
                this.buffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.nbBytes, gl.DYNAMIC_DRAW);
                break;

            case glDynamicBufferType.Texture:
                this.texture = gl.createTexture();

                // Point sampling with clamp for indexing
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                // Fixed-format for now
                assert(this.elementType == gl.BYTE);
                assert(this.nbElements == 1);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, this.nbEntries, 1, 0, gl.ALPHA, gl.UNSIGNED_BYTE, this.cpuArray);
            
                break;

            default:
                assert(false, "Unsupported dynamic buffer type");
        }
    }
};
