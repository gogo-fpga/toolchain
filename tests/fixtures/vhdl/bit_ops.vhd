library ieee;
use ieee.std_logic_1164.all;

package bit_ops is
  function invert(value : std_logic) return std_logic;
end package;

package body bit_ops is
  function invert(value : std_logic) return std_logic is
  begin
    return not value;
  end function;
end package body;
