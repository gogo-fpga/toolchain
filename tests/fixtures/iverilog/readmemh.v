module top;
  reg [7:0] memory [0:1];
  initial begin
    $readmemh("work/src/data.hex", memory);
    $dumpfile("wave.vcd");
    $dumpvars(0, top);
    #1 $display("memory=%h%h", memory[0], memory[1]);
    $finish;
  end
endmodule
