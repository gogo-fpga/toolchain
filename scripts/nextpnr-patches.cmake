if(NOT CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
  return()
endif()

if(DEFINED WASI_OPT_FLAGS AND NOT WASI_OPT_FLAGS STREQUAL "")
  include("${CMAKE_CURRENT_LIST_DIR}/s5-wasi-opt-flags.cmake")
endif()

function(toolchain_prepare_nextpnr_source)
  set(toolchain_root "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/..")
  set(patch "${toolchain_root}/patches/nextpnr/0002-stabilize-equal-coordinate-cuts.patch")
  set(preparer "${toolchain_root}/scripts/prepare-pnr-source.py")
  set(patched_source "${CMAKE_BINARY_DIR}/patched/placer_heap.cc")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${patch}" "${preparer}" "${CMAKE_SOURCE_DIR}/common/place/placer_heap.cc")
  find_program(toolchain_python python3 REQUIRED)
  execute_process(
    COMMAND "${toolchain_python}" "${preparer}"
      --source "${CMAKE_SOURCE_DIR}/common/place/placer_heap.cc"
      --patch "${patch}" --output "${patched_source}"
    RESULT_VARIABLE patch_status
  )
  if(NOT patch_status EQUAL 0)
    message(FATAL_ERROR "Failed to prepare the nextpnr translation unit")
  endif()
  if(NOT TARGET nextpnr-himbaechel-gowin OR NOT TARGET nextpnr_place)
    message(FATAL_ERROR "The expected nextpnr Gowin or placer target is missing")
  endif()
  get_target_property(original_sources nextpnr_place INTERFACE_SOURCES)
  set(patched_sources)
  set(replacements 0)
  foreach(source IN LISTS original_sources)
    if(source MATCHES "(^|/)common/place/placer_heap\\.cc$")
      list(APPEND patched_sources "${patched_source}")
      math(EXPR replacements "${replacements} + 1")
    else()
      list(APPEND patched_sources "${source}")
    endif()
  endforeach()
  if(NOT replacements EQUAL 1)
    message(FATAL_ERROR "Expected exactly one nextpnr heap placer translation unit")
  endif()
  set_property(TARGET nextpnr_place PROPERTY INTERFACE_SOURCES "${patched_sources}")
endfunction()

cmake_language(DEFER CALL toolchain_prepare_nextpnr_source)
